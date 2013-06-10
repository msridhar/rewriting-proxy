/*******************************************************************************
 * Copyright (c) 2013 Max Schaefer.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v10.html
 *
 * Contributors:
 *     Max Schaefer - initial API and implementation
 *******************************************************************************/

/*global require console Buffer __dirname process*/

var http = require('http'),
    path = require('path'),
    fs = require('fs'),
    url = require('url'),
    esprima = require('esprima'),
    escodegen = require('escodegen'),
    htmlparser = require('htmlparser'),
    htmlparser2html = require('htmlparser-to-html'),
    Entities = require('html-entities').AllHtmlEntities;

var entities = new Entities();
    
if(process.argv.length <= 2) {
	console.error("Usage: node proxy.js REWRITER");
	process.exit(-1);
}

var rewriter = require(path.resolve(__dirname, process.argv[2]));

var unparseable_count = 0;
function rewrite(src, metadata) {
	var result, parsed;
	try {
		var parsed_url = url.parse(metadata.url);
		var file = path.basename(parsed_url.pathname) + parsed_url.hash;
		
		var prefix = "";
		if(src.match(/^javascript:/i)) {
			prefix = src.substring(0, "javascript".length+1);
			src = src.substring(prefix.length);
		}
		
		var ast = esprima.parse(src, { loc: true, range: true, tolerant: true });
		parsed = true;
		metadata.source = src;
		result = rewriter.rewrite(ast, metadata);
		
		if(typeof result === 'object')
			result = escodegen.generate(result);
		result = prefix+result;
	} catch(e) {
		console.warn("Couldn't " + (parsed ? "process" : "parse") + " " + metadata.url + " as JavaScript; passing on un-instrumented and writing source to /tmp/unparseable" + unparseable_count + ".js");
		fs.writeFileSync("/tmp/unparseable" + (unparseable_count++) + ".js", src);
		result = src;
	}
	return result;
}

var script_counter = 0, event_handler_counter = 0, js_url_counter = 0;

// event handler attributes
var event_handler_attribute_names = [ "onabort", "onblur", "onchange", "onclick", "ondblclick",
                                      "onerror", "onfocus", "onkeydown", "onkeypress", "onkeyup",
                                      "onload", "onmousedown", "onmousemove", "onmouseout", "onmouseover",
                                      "onmouseup", "onreset", "onresize", "onselect", "onsubmit", "onunload" ];
                                      
// attributes that may contain URLs (unsure whether all of these can actually contain 'javascript:' URLs)
var url_attribute_names = [ "action", "cite", "code", "codebase", "data", "href", "manifest", "poster", "src" ];

function walkDOM(node, url) {
	var src, metadata;
	
	// handle scripts (but skip empty ones)
	if(node.children && node.type === 'script') {
		// scripts without type are assumed to contain JavaScript
		if(!node.attribs || !node.attribs.type || node.attribs.type.match(/JavaScript/i)) {
			// only rewrite inline scripts; external scripts are handled by request rewriting
			if(!node.attribs || !node.attribs.src) {
				src = "";
				for(var i=0,n=node.children.length;i<n;++i) {
					if(node.children[i].type === 'text' || node.children[i].type === 'comment')
						src += node.children[i].raw;
					else
						throw new Error("script has child of type " + node.children[i].type + "; that's not supposed to happen");
				}
				metadata = { type: 'script', inline: true, url: url + "#inline-" + (script_counter++) };
				
				node.children.length = 1;
				node.children[0].type = 'text';
				node.children[0].raw = node.children[0].data = rewrite(src, metadata);
			}
		}
	}
	
	// handle event handlers and 'javascript:' URLs
	if(node.attribs) {
		for(var attrib in node.attribs) {
			if(node.attribs.hasOwnProperty(attrib)) {
				if(event_handler_attribute_names.indexOf(attrib) !== -1) {
					src = entities.decode(String(node.attribs[attrib]));
					metadata = { type: 'event-handler', url: url + "#event-handler-" + (event_handler_counter++) };
					node.attribs[attrib] = entities.encode(rewrite(src, metadata));
				} else if(url_attribute_names.indexOf(attrib) !== -1 && String(node.attribs[attrib]).match(/^javascript:/i)) {
					src = entities.decode(String(node.attribs[attrib]));
					metadata = { type: 'javascript-url', url: url + "#js-url-" + (js_url_counter++) };
					node.attribs[attrib] = entities.encode(rewrite(src, metadata));
				}
			}
		}
	}
	
	if(node.type === 'tag' && node.children)
		node.children.forEach(function(ch) { walkDOM(ch, url); });
	else if(Array.isArray(node))
		node.forEach(function(ch) { walkDOM(ch, url); });
}

http.createServer(function(request, response) {
    var proxy = http.createClient(80, request.headers.host);
    
    // make sure we won't get back gzipped stuff
    delete request.headers['accept-encoding'];
    
    console.log("requesting " + request.url);
    
    // send off the proxy request
    var proxy_request = proxy.request(request.method, request.url, request.headers);
    
    proxy_request.addListener('response', function (proxy_response) {
		var tp = proxy_response.headers['content-type'] || "", buf = "";
		var url_path = url.parse(request.url).pathname;
		
		if(tp.match(/JavaScript/i) || tp.match(/text/i) && url_path.match(/\.js$/i))
			tp = "JavaScript";
		else if(tp.match(/HTML/i))
			tp = "HTML";
		else
			tp = "other";
      
		proxy_response.addListener('data', function(chunk) {
			if(tp === "other")
				response.write(chunk, 'binary');
			else
				buf += chunk.toString();
		});
		
		proxy_response.addListener('end', function() {
			var output;
			if(tp === "JavaScript") {
				output = rewrite(buf, { type: 'script', inline: false, url: request.url, source: buf });
		    } else if(tp === "HTML") {
				var handler = new htmlparser.DefaultHandler();
				var HTMLParser = new htmlparser.Parser(handler);
				HTMLParser.parseComplete(buf);
				walkDOM(handler.dom, request.url);
				output = htmlparser2html(handler.dom);
		    }
		    
		    if(output) {
			    proxy_response.headers['content-length'] = Buffer.byteLength(output, 'utf-8');
			    response.writeHead(proxy_response.statusCode, proxy_response.headers);
			    response.write(output);
			}
			
		    response.end();
		});
		
		if(tp === "other")
			response.writeHead(proxy_response.statusCode, proxy_response.headers);
    });

    request.addListener('data', function(chunk) {
		proxy_request.write(chunk, 'binary');
    });

    request.addListener('end', function() {
		proxy_request.end();
    });
}).listen(8080);

console.log("Listening on port 8080");