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
    jsdom = require('jsdom'),
    assert = require("assert");

var core = jsdom.browserAugmentation(jsdom.level(3));

var impl = new core.DOMImplementation();

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

function walkDOM(node, url, rewriteFunc, headerHTML, headerURLs) {
    var src, metadata;
    var tagName = (node.tagName || "").toLowerCase();
    if (tagName === 'head' && (headerHTML || headerURLs)) {
        // first, recursively process any child nodes
        for (var ch=node.firstChild;ch;ch=ch.nextSibling) {
            walkDOM(ch, url, rewriteFunc, headerHTML, headerURLs);
        }
        // then, insert header code as first child
        var innerHTML = node.innerHTML;
        if (headerHTML) {
            innerHTML = headerHTML + innerHTML;
        }
        if (headerURLs) {
            var urlTags = "";
            for (var i = 0; i < headerURLs.length; i++) {
                urlTags += "<script src=\"" + headerURLs[i] + "\"></script>";
            }
            innerHTML = urlTags + innerHTML;
        }
        node.innerHTML = innerHTML;
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
	    walkDOM(node.childNodes[i], url, rewriteFunc, headerHTML, headerURLs);
}

/**
 * rewrite all the scripts in an HTML string
 * @param html the original HTML
 * @param url the URL for the HTML.  if none, just pass in ""
 * @param rewriter a callback function invoked to instrument JS code.  for further details, see start() docs
 * @param headerHTML a String of HTML to be inserted just after the <head> tag
 *  in any HTML
 * @param headerURLs an Array of script URLs.  These URLs will be loaded
 *  via <script> tags at the beginning of any HTML file.
 * @returns {string} the instrumented HTML
 */
function rewriteHTML(html, url, rewriter, headerHTML, headerURLs) {
    assert(rewriter, "must pass a rewriting function");
    var document = impl.createDocument();
    var parser = new HTML5.JSDOMParser(document, core);
    parser.parse(html);
    walkDOM(document, url, rewriter, headerHTML, headerURLs);
    return document.innerHTML;
}

var server = null;

/**
 * starts up the instrumenting proxy.
 * @param options Specifies options for the proxy.  Required fields:
 *  - options.rewriter: a function that takes JS code as a string and some
 *    additional metadata and returns the string instrumented code.  The
 *    metadata object m includes fields:
 *       - m.url: the URL of the JS code.  For inline scripts, we append
 *                '#inline-x' for a regular inline script, '#event-handler-x'
 *                for an event handler, or '#js-url-x' for a "javascript:" URL
 *                script, with x being a unique identifier
 *       - m.type: 'script' for regular scripts (inline or external),
 *                 'event-handler' for inline event handler script,
 *                 'javascript-url' for inline script in a "javascript:" URL
 *  Optional fields:
 *  - options.headerHTML: a String of HTML to be inserted just after the <head> tag
 *  in any HTML
 *  - options.headerURLs: an Array of script URLs.  These URLs will be loaded
 *  via <script> tags at the beginning of any HTML file.
 *  - options.noInstRegExp: a RegExp to match against URLs; if the URL matches, no
 *  instrumentation or rewriting will be done
 *  - options.intercept: a function that takes a URL string from a request and returns
 *  JavaScript code for the response, or null if the request should be forwarded to the
 *  remote server.
 */
function start(options) {
	assert(options.rewriter, "must provide rewriter function in options.rewriter");
	var headerHTML = options.headerHTML;
    var headerURLs = options.headerURLs;
	var rewriteFunc = options.rewriter;
    var intercept = options.intercept;
    var noInstRegExp = options.noInstRegExp;
	server = http.createServer(function (request, response) {
		// make sure we won't get back gzipped stuff
		delete request.headers['accept-encoding'];
        console.log("request: " + request.url);
        if (intercept) {
            var interceptScript = intercept(request.url);
            if (interceptScript) {
                // send the script back directly
                var iceptHeaders = {
                    'content-type': 'application/javascript',
                    'content-length': Buffer.byteLength(interceptScript, 'utf-8')
                };
                response.writeHead(200, iceptHeaders);
                response.write(interceptScript);
                response.end();
                return;
            }
        }
        var noInst = noInstRegExp && noInstRegExp.test(request.url);
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
            if (noInst) {
                tp = "other";
            } else if (tp.match(/JavaScript/i) || tp.match(/text/i) && url_path.match(/\.js$/i)) {
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
					output = rewriteHTML(buf, request.url, rewriteFunc, headerHTML, headerURLs);
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
}
exports.start = start;
exports.rewriteHTML = rewriteHTML;
