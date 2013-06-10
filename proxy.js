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
    acorn = require('acorn'),
    escodegen = require('escodegen');
    
if(process.argv.length <= 2) {
	console.error("Usage: node proxy.js REWRITER");
	process.exit(-1);
}

var rewriter = require(process.argv[2]);

http.createServer(function(request, response) {
    var proxy = http.createClient(80, request.headers.host);
    
    delete request.headers['accept-encoding'];
    console.log("requesting " + request.url);
    var proxy_request = proxy.request(request.method, request.url, request.headers);
    
    var url_path = url.parse(request.url).pathname;
    
    proxy_request.addListener('response', function (proxy_response) {
		var tp = proxy_response.headers['content-type'] || "", buf = "";
		if(tp.match(/JavaScript/i) || tp.match(/text/i) && url_path.match(/\.js$/i))
			tp = "JavaScript";
		else if(tp.match(/HTML/i))
			tp = "HTML";
		else
			tp = "other";
      
		proxy_response.addListener('data', function(chunk) {
			if(tp !== "JavaScript")
				response.write(chunk, 'binary');
			else
				buf += chunk.toString();
		});
		
		proxy_response.addListener('end', function() {
			if(tp === "JavaScript") {
				var output;
				try {
					var file = path.basename(url_path);
					var ast = acorn.parse(buf, { locations: true, ranges: true, sourceFile: file });
					output = rewriter.rewrite(ast, { type: 'script', url: request.url, source: buf });
					if(typeof output === 'object')
						output = escodegen.generate(output);
					console.log("Successfully instrumented " + request.url);
				} catch(e) {
					console.warn("Couldn't parse " + request.url + " as JavaScript; passing on un-instrumented");
					output = buf;
				}
			    proxy_response.headers['content-length'] = Buffer.byteLength(output, 'utf-8');
			    response.writeHead(proxy_response.statusCode, proxy_response.headers);
			    response.write(output);
		    }
		    response.end();
		});
		
		if(tp !== 'JavaScript')
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