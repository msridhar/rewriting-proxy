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
var proxy = require("../rewriting-proxy");
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
		it('should not rewrite header script', function () {
			var html = "<html><head></head><body></body></html>";
			var inst = proxy.rewriteHTML(html, "http://foo.com", function () {
				return "bar";
			}, "alert(\"hi\");");
			assert.equal(inst, "<html><head><script>alert(\"hi\");</script></head><body></body></html>");
		});
		it('should encode attribute values properly', function () {
			var html = "<html><head></head><body><button onclick=\"foo()\">Hello</button></body></html>";
			var rewriter = function (src) {
				return "if (x < y) " + src;
1			};
			var inst = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
			assert.equal(inst, "<html><head></head><body><button onclick=\"if (x &lt; y) foo()\">Hello</button></body></html>");
		});
		it('should be robust to crashing instrumenting function', function () {
			var html = "<html><head></head><body><button onclick=\"foo()\">Hello</button></body></html>";
			var rewriter = function (src) { throw "I crashed"; };
			var inst = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
			assert.equal(inst, html);
		});

	        it('should rewrite script tags without attributes', function() {
		        var html = "<html><head></head><script>foo</script><body></body></html>";
		        var expected = "<html><head></head><script>bar</script><body></body></html>";
		        var rewriter = function () { return "bar"; }
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(actual, expected);
		});
	        it('should rewrite script tags without type attribute', function() {
		        var html = "<html><head></head><script foo=\"bar\">foo</script><body></body></html>";
		        var expected = "<html><head></head><script foo=\"bar\">bar</script><body></body></html>";
		        var rewriter = function () { return "bar"; }
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(actual, expected);
		});
	        it('should rewrite script tags with type javascript', function() {
		        var html = "<html><head></head><script type=\"javascript\">foo</script><body></body></html>";
		        var expected = "<html><head></head><script type=\"javascript\">bar</script><body></body></html>";
		        var rewriter = function () { return "bar"; }
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(actual, expected);
		});
	        it('should rewrite script tags with type text/javascript', function() {
		        var html = "<html><head></head><script type=\"text/javascript\">foo</script><body></body></html>";
		        var expected = "<html><head></head><script type=\"text/javascript\">bar</script><body></body></html>";
		        var rewriter = function () { return "bar"; }
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(actual, expected);
		});
	        it('should rewrite script tags with type text/JAVAscript', function() {
		        var html = "<html><head></head><script type=\"text/JAVAscript\">foo</script><body></body></html>";
		        var expected = "<html><head></head><script type=\"text/JAVAscript\">bar</script><body></body></html>";
		        var rewriter = function () { return "bar"; }
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(actual, expected);
		});
	        it('should not rewrite script tags with type vbscript', function() {
		        var html = "<html><head></head><script type=\"vbscript\">foo</script><body></body></html>";
		        var expected = html;
		        var rewriter = function () { return "bar"; }
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(actual, expected);
		});
	        it('should not rewrite external scripts', function() {
		        var html = "<html><head></head><script src=\"foo.js\"></script><body></body></html>";
		        var rewriter_called = false;
		        var rewriter = function (src) { rewriter_called = true; return src; }
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(rewriter_called, false);
		});
	        it('should rewrite event handler attributes', function() {
		        var html = "<html><head></head><body onload=\"foo\"></body></html>";
		        var expected = "<html><head></head><body onload=\"bar\"></body></html>";
		        var rewriter = function () { return "bar"; };
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(actual, expected);
		});
	        it('should rewrite javascript: URLs', function() {
		        var html = "<html><head></head><body><a href=\"javascript:foo\"></a></body></html>";
		        var expected = "<html><head></head><body><a href=\"javascript:bar\"></a></body></html>";
		        var rewriter = function () { return "bar"; };
		        var actual = proxy.rewriteHTML(html, "http://foo.com", rewriter, null);
		        assert.equal(actual, expected);
		});
	});
});
