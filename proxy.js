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

/*jslint node: true */
/*global require console Buffer __dirname process*/

var http = require('http'),
    path = require('path'),
    url = require('url'),
    htmlparser = require('htmlparser'),
    htmlparser2html = require('htmlparser-to-html'),
    Entities = require('html-entities').AllHtmlEntities;

var entities = new Entities();
    
var unparseable_count = 0;

var headerCode = null;

var rewriteFunc = null;

function rewriteScript(src, metadata) {
	var result;
		
	var prefix = "";
	if(src.match(/^javascript:/i)) {
		prefix = src.substring(0, "javascript".length+1);
		src = src.substring(prefix.length);
	}
	
	result = rewriteFunc(src, metadata);		
	result = prefix+result;
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

	if (node.name === 'head' && headerCode) {
		// try sticking a script at the beginning
		var newScript = {
			raw: 'script',
			data: 'script',
			type: 'script',
			name: 'script',
			children: [ {
				type: 'text', 
				raw: headerCode,
				data: headerCode
			} ]
		};
		if (node.children) {
			node.children.unshift(newScript);
			// don't instrument the new script
			node.children.forEach(function (ch) {
				if (ch !== newScript) {
					walkDOM(ch, url);
				}
			});
		} else {
			node.children = [newScript];
		}
		return;
	}
	// handle scripts (but skip empty ones)
	if(node.children && node.type === 'script') {
		// scripts without type are assumed to contain JavaScript
		if(!node.attribs || !node.attribs.type || node.attribs.type.match(/JavaScript/i)) {
			// only rewrite inline scripts; external scripts are handled by request rewriting
			if(!node.attribs || !node.attribs.src) {
				src = "";
				for(var i=0,n=node.children.length;i<n;++i) {
					if(node.children[i].type === 'text' || node.children[i].type === 'comment') {						
						src += node.children[i].raw;
					} else {
						throw new Error("script has child of type " + node.children[i].type + "; that's not supposed to happen");
					}
				}
				metadata = { type: 'script', inline: true, url: url + "#inline-" + (script_counter++) };
				
				node.children.length = 1;
				node.children[0].type = 'text';
				node.children[0].raw = node.children[0].data = rewriteScript(src, metadata);
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
					node.attribs[attrib] = entities.encode(rewriteScript(src, metadata));
				} else if(url_attribute_names.indexOf(attrib) !== -1 && String(node.attribs[attrib]).match(/^javascript:/i)) {
					src = entities.decode(String(node.attribs[attrib]));
					metadata = { type: 'javascript-url', url: url + "#js-url-" + (js_url_counter++) };
					node.attribs[attrib] = entities.encode(rewriteScript(src, metadata));
				}
			}
		}
	}
	
	if(node.type === 'tag' && node.children) {
		node.children.forEach(function(ch) { walkDOM(ch, url); });
	}
	else if(Array.isArray(node)) {
		node.forEach(function(ch) { walkDOM(ch, url); });
	}
}

var server = null;

function start(options) {
	headerCode = options.headerCode;
	rewriteFunc = options.rewriter;
	server = http.createServer(function(request, response) {
	    // make sure we won't get back gzipped stuff
	    delete request.headers['accept-encoding'];
		
		console.log("request: " + request.url);
		var parsed = url.parse(request.url);
		var options = {
			hostname: parsed.hostname,
			path: parsed.path,
			port: parsed.port ? parsed.port : 80,
			method: request.method,
			headers: request.headers
		};
		var proxyRequest = http.request(options, function(proxy_response) {
			var tp = proxy_response.headers['content-type'] || "", buf = "";
			var url_path = parsed.pathname;
			
			if(tp.match(/JavaScript/i) || tp.match(/text/i) && url_path.match(/\.js$/i)) {
				tp = "JavaScript";
			} else if(tp.match(/HTML/i)) {
				tp = "HTML";
			} else {
				tp = "other";
			}
	      
			proxy_response.on('data', function(chunk) {
				if(tp === "other") {
					response.write(chunk, 'binary');
				} else {
					buf += chunk.toString();
				}
			});
			
			proxy_response.on('end', function() {
				var output;
				if(tp === "JavaScript") {
					output = rewriteScript(buf, { type: 'script', inline: false, url: request.url, source: buf });
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
			
			if(tp === "other") {
				response.writeHead(proxy_response.statusCode, proxy_response.headers);
			}
		});
		proxyRequest.on('error', function (e) {
			console.log("request error " + e.message);
		});
	    request.on('data', function(chunk) {
			proxyRequest.write(chunk, 'binary');
	    });
	
	    request.on('end', function() {
			proxyRequest.end();
	    });
	});
	var port = options.port ? options.port : 8080;
	server.listen(port);
	console.log("listening on port " + port);
}

exports.start = start;