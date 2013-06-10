rewriting-proxy
===============

Simple proxy for rewriting JavaScript on-the-fly.


Usage
-----

	node proxy.js rewriter.js
	
The file `rewriter.js` should be a Node module exporting a function `rewrite`.
	
A proxy is started listening on `localhost:8080`. Any response with a MIME type suggesting JavaScript content is parsed into an AST,
which is passed as the first argument to `rewrite`. The second argument is the raw source code, whereas the third argument is an object
with some information about the provenance of the JavaScript code (not documented yet).


License
-------

This software is distributed under the [Eclipse Public License](http://www.eclipse.org/legal/epl-v10.html).
