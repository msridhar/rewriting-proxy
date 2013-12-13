/*******************************************************************************
 * Copyright (c) 2013 Samsung Information Systems America, Inc.
 * 
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v10.html
 *
 * Contributors:
 *     Manu Sridharan - initial API and implementation
 *******************************************************************************/

/*jslint node: true */
/*global describe it */
var assert = require("assert");
var proxy = require("../proxy");
describe('rewriting-proxy', function () {
	describe('#rewriteHTML()', function () {
		it('should do nothing', function () {
			var html = "<html><head></head><body></body></html>";
			var inst = proxy.rewriteHTML(html, "http://foo.com", function (str) {
				return str;
			}, null);
			assert.equal(inst, html);
		});
		it('should insert header script', function () {
			var html = "<html><head></head><body></body></html>";
			var inst = proxy.rewriteHTML(html, "http://foo.com", function (str) {
				return str;
			}, "alert(\"hi\");");
			assert.equal(inst, "<html><head><script>alert(\"hi\");</script></head><body></body></html>");
		});
		it('should encode attribute values properly', function () {
			var html = "<html><head></head><body><button onclick=\"foo()\">Hello</button></body></html>";
			var rewriter = function (src) {
				return "if (x < y) " + src;
			};
			var inst = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
			assert.equal(inst, "<html><head></head><body><button onclick=\"if (x &lt; y) foo()\">Hello</button></body></html>");
		});
		it('should be robust to crashing instrumenting function', function () {
			var html = "<html><head></head><body><button onclick=\"foo()\">Hello</button></body></html>";
			var rewriter = function (src) { throw "I crashed"; };
			var inst = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
			assert.equal(inst, html);
		});
	});
});