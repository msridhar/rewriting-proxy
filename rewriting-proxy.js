/*******************************************************************************
 * Copyright (c) 2013 Max Schaefer.
 * Copyright (c) 2013 Samsung Information Systems America, Inc.
 * 
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v10.html
 *
 * Contributors:
 *     Max Schaefer - initial API and implementation
 *     Manu Sridharan - refactoring and bug fixes
 *******************************************************************************/
/*jslint node: true */
/*global require console Buffer __dirname process*/
var http = require('http'),
    path = require('path'),
    urlparser = require('url'),
    HTML5 = require('html5'),
    assert = require("assert");
var unparseable_count = 0;

function rewriteScript(src, metadata, rewriteFunc) {
	var result;
	var prefix = "";
	if (src.match(/^javascript:/i)) {
		prefix = src.substring(0, "javascript".length + 1);
		src = src.substring(prefix.length);
	}
	try {
		result = rewriteFunc(src, metadata);
	} catch (e) {
		console.log("exception while rewriting script " + metadata.url);
		console.log(e);
		return src;
	}
	result = prefix + result;
	return result;
}

var script_counter = 0,
	event_handler_counter = 0,
	js_url_counter = 0;
// event handler attributes
var event_handler_attribute_names = ["onabort", "onblur", "onchange", "onclick", "ondblclick",
	"onerror", "onfocus", "onkeydown", "onkeypress", "onkeyup",
	"onload", "onmousedown", "onmousemove", "onmouseout", "onmouseover",
	"onmouseup", "onreset", "onresize", "onselect", "onsubmit", "onunload"
];
// attributes that may contain URLs (unsure whether all of these can actually contain 'javascript:' URLs)
var url_attribute_names = ["action", "cite", "code", "codebase", "data", "href", "manifest", "poster", "src"];

function walkDOM(node, url, rewriteFunc, headerCode) {
    var src, metadata;
    var tagName = (node.tagName || "").toLowerCase();

    if (tagName === 'head' && headerCode) {
	// first, recursively process any child nodes
	for (var ch=node.firstChild;ch;ch=ch.nextSibling)
	    walkDOM(ch, url, rewriteFunc, headerCode);
	// then, insert header code as first child
	node.innerHTML = "<script>" + headerCode + "</script>" + node.innerHTML;
	return;
    } else if(tagName === 'script' && node.hasChildNodes()) {
	// handle scripts (but skip empty ones)
	// scripts without type are assumed to contain JavaScript
	if (!node.getAttribute("type") || node.getAttribute("type").match(/JavaScript/i)) {
	    // only rewrite inline scripts; external scripts are handled by request rewriting
	    if (!node.getAttribute("src")) {
		src = "";
		for (var ch=node.firstChild;ch;ch=ch.nextSibling)
		    src += ch.nodeValue;
		metadata = {
		    type: 'script',
		    inline: true,
		    url: url + "#inline-" + (script_counter++)
		};
		node.textContent = rewriteScript(src, metadata, rewriteFunc);
	    }
	}
    } else if(node.nodeType === 1) {
	// handle event handlers and 'javascript:' URLs
	event_handler_attribute_names.forEach(function(attrib) {
	    if (node.hasAttribute(attrib)) {
		var src = node.getAttribute(attrib)+"";
		metadata = {
		    type: 'event-handler',
		    url: url + "#event-handler-" + (event_handler_counter++)
		};
		node.setAttribute(attrib, rewriteScript(src, metadata, rewriteFunc));
	    }
	});
	url_attribute_names.forEach(function(attrib) {
	    var val = node.getAttribute(attrib)+"";
	    if (val && val.match(/^javascript:/i)) {
		metadata = {
		    type: 'javascript-url',
		    url: url + "#js-url-" + (js_url_counter++)
		};
		node.setAttribute(attrib, rewriteScript(val, metadata, rewriteFunc));
	    }
	});
    }

    if (node.childNodes && node.childNodes.length)
	for (var i=0,n=node.childNodes.length;i<n;++i)
	    walkDOM(node.childNodes[i], url, rewriteFunc, headerCode);
}

/**
 * rewrite all the scripts in the given html string, using the rewriteFunc function
 */
function rewriteHTML(html, url, rewriter, headerCode) {
    assert(rewriter, "must pass a rewriting function");
    var parser = new HTML5.Parser();
    parser.parse(html);
    walkDOM(parser.document, url, rewriter, headerCode);
    return parser.document.innerHTML;
}

var server = null;

/**
 * starts up the instrumenting proxy.
 * @param options Specifies options for the proxy.  Required fields:
 *  - options.headerCode: a String that includes code to be inserted as
 *     an inline script at the beginning of any HTML file
 *  - options.rewriter: a function that takes JS code as a string and some
 *    additional metadata and returns the string instrumented code.  The
 *    metadata object m includes fields:
 *       - m.url: the URL of the JS code.  TODO describe URL scheme for inline scripts
 */
function start(options) {
	assert(options.rewriter, "must provide rewriter function in options.rewriter");
	var headerCode = options.headerCode;
	var rewriteFunc = options.rewriter;
	server = http.createServer(function (request, response) {
		// make sure we won't get back gzipped stuff
		delete request.headers['accept-encoding'];
		console.log("request: " + request.url);
		var parsed = urlparser.parse(request.url);
		var http_request_options = {
			hostname: parsed.hostname,
			path: parsed.path,
			port: parsed.port ? parsed.port : 80,
			method: request.method,
			headers: request.headers
		};
		var proxyRequest = http.request(http_request_options, function (proxy_response) {
			var tp = proxy_response.headers['content-type'] || "",
				buf = "";
			var url_path = parsed.pathname;
			if (tp.match(/JavaScript/i) || tp.match(/text/i) && url_path.match(/\.js$/i)) {
				tp = "JavaScript";
			} else if (tp.match(/HTML/i)) {
				tp = "HTML";
			} else {
				tp = "other";
			}
			proxy_response.on('data', function (chunk) {
				if (tp === "other") {
					response.write(chunk, 'binary');
				} else {
					buf += chunk.toString();
				}
			});
			proxy_response.on('end', function () {
				var output;
				if (tp === "JavaScript") {
					output = rewriteScript(buf, {
						type: 'script',
						inline: false,
						url: request.url,
						source: buf
					}, rewriteFunc);
				} else if (tp === "HTML") {
					output = rewriteHTML(buf, request.url, rewriteFunc, headerCode);
				}
				if (output) {
					proxy_response.headers['content-length'] = Buffer.byteLength(output, 'utf-8');
					response.writeHead(proxy_response.statusCode, proxy_response.headers);
					response.write(output);
				}
				response.end();
			});
			if (tp === "other") {
				response.writeHead(proxy_response.statusCode, proxy_response.headers);
			}
		});
		proxyRequest.on('error', function (e) {
			console.log("request error " + e.message);
		});
		request.on('data', function (chunk) {
			proxyRequest.write(chunk, 'binary');
		});
		request.on('end', function () {
			proxyRequest.end();
		});
	});
	var port = options.port ? options.port : 8080;
	server.listen(port);
	console.log("listening on port " + port);
}
exports.start = start;
exports.rewriteHTML = rewriteHTML;
