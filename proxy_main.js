/*jslint node: true */

var proxy = require("./proxy");

var options = {
	rewriter: function (src, metadata) {
		console.log("instrumenting " + metadata.url);
		return src;		
	},
	headerCode: "alert(\"hi\");",
	port: 8080
};

proxy.start(options);