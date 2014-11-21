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

var proxy = require("./rewriting-proxy");

var options = {
	rewriter: function (src, metadata) {
		console.log("instrumenting " + metadata.url);
		return src;		
	},
	headerHTML: "<script>alert(\"hi\");</script>",
	port: 8080
};

proxy.start(options);