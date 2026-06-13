// @ts-nocheck
// Generated from src/schema by scripts/build-data.ts. Do not edit by hand.
window.KIND_DESCRIPTIONS = {
	"nodes": {
		"Module": "A source file in the codebase.",
		"Class": "A class declaration.",
		"Interface": "An interface declaration.",
		"TypeAlias": "A type alias declaration.",
		"Enum": "An enum declaration.",
		"Function": "A standalone, module-level function.",
		"Method": "A function that belongs to a class or interface.",
		"Property": "A field declared on a class or interface.",
		"Parameter": "A parameter of a function or method.",
		"Variable": "A module- or block-level variable binding.",
		"ExternalModule": "An imported third-party or Node.js module, recorded as one opaque node per import specifier.",
		"ConfigFlag": "An environment-variable configuration flag, detected from process.env reads.",
		"ExternalAPI": "An outbound HTTP host called through fetch(), with one node per host.",
		"Endpoint": "An HTTP route registered by the app, such as app.get(\"/users\", handler)."
	},
	"edges": {
		"CONTAINS": "Structural nesting: the source declares or encloses the target (a module contains a class, which contains a method).",
		"IMPORTS": "The source module imports the target.",
		"EXPORTS": "The source module exports the target symbol.",
		"EXTENDS": "The source class or interface extends the target (inheritance).",
		"IMPLEMENTS": "The source class implements the target interface.",
		"USES_TYPE": "The source references the target in a type position.",
		"RETURNS": "The target type appears in the source function or method return type.",
		"PARAM_TYPE": "The target type appears in one of the source parameter types.",
		"CALLS": "The source function or method calls the target.",
		"INSTANTIATES": "The source constructs the target class with new.",
		"OVERRIDES": "The source method overrides the base-class member it replaces.",
		"READS": "The source reads the value of the target variable or property.",
		"WRITES": "The source assigns to the target variable or property.",
		"READS_CONFIG": "The source reads the target configuration flag (an environment variable).",
		"CALLS_EXTERNAL": "The source makes an outbound HTTP call to the target external API.",
		"HANDLES": "Links an HTTP endpoint to the function that handles it (route to handler)."
	}
};
