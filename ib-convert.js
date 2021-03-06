const fs = require("fs");
const path = require("path");
const dom = require("htmldom2").DOMParser;
const serializer = require("htmldom2").XMLSerializer;
const xpath = require("xpath");
const pretty = require('pretty');

/*
 * Paths
 */
const jurisMapPath = (fn) => {
    var stub = path.join("..", "JM", "jurism", "juris-maps");
    if (fn) {
        return path.join(stub, fn);
    } else {
        return stub;
    }
}

const buildPath = (fn) => {
    var stub = path.join(".", "build");
    fs.mkdirSync(stub, {recursive: true});
    if (fn) {
        return path.join(stub, fn);
    } else {
        return stub;
    }
}

const itemDataPath = (fn) => {
    var stub = path.join(buildPath(), "static", "itemdata");
    fs.mkdirSync(stub, {recursive: true});
    if (fn) {
        return path.join(stub, fn);
    } else {
        return stub;
    }
}

/*
  Initialize original DOM as source
*/
// Saved as Web Page from Word
var html_txt = fs.readFileSync("sample.html").toString();
var doc = new dom().parseFromString(html_txt, "text/html");


/*
  Initialize new DOM as output target.
*/
var template = `
<html>
  <head>
    <title>Indigo Book</title>
  </head>
  <body/>
</html>
`.trim();
var newdoc = new dom().parseFromString(template, "text/html");

/*
 * Conversion factory
 */
function Walker (doc, newdoc) {
    this.citePos = 1;
    this.body = xpath.select("//body", doc)[0];
    this.newdoc = newdoc;
    this.newbody = xpath.select("//body", newdoc)[0];
    
    // Only these node types are of interest
    this.processTypes = {
        1: "node",
        3: "text",
        8: "comment"
    }
    
    // Converted nodes are appended to the node at the end of the "stack" array.
    this.stack = [this.newbody];

    // Load jurisdiction maps, to expand extracted jurisdiction field codes
    this.jurisdictionMap = this.getJurisdictionMap("us");

    var signalMap = {
        none: "",
        eg: "e.g.",
        accord: "accord",
        see: "see",
        seealso: "see also",
        seeeg: "see, e.g.",
        cf: "cf.",
        contra: "contra",
        butsee: "but see",
        seegenerally: "see generally",
        Eg: "E.g.",
        Accord: "Accord",
        See: "See",
        Seealso: "See also",
        Seeeg: "See, e.g.",
        Cf: "Cf.",
        Contra: "Contra",
        Butsee: "But see",
        Butseeeg: "But see, e.g.",
        Seegenerally: "See generally",
        butcf: "but cf.",
        compare: "compare",
        Butcf: "But cf.",
        Compare: "Compare",
        with: "with",
        and: "and",
        affirmed: "aff'd",
        affirming: "aff'g",
        certdenied: "cert. denied",
        other: "on other grounds",
        revsub: "sub nom.",
        affirmed: "aff'd",
        affirming: "aff'g",
        certdenied: "cert. denied",
        reversed: "rev'd",
        other: "on other grounds",
        subnom: "sub nom.",
        description: "Description of content,",
        semicolon: "; "
    }
    delete signalMap["none"];

    this.signalMap = signalMap;

    this.reverseSignalMap = function() {
        var ret = {};
        for (var key in signalMap) {
            var val = signalMap[key].replace(/[¥s,]*$/, "");
            ret[val] = key;
        }
        return ret;
    }();

    this.reverseSignalRex = new RegExp(`(${Object.keys(this.reverseSignalMap).join("|")})`)
}

Walker.prototype.run = function() {
    this.processInputTree(this.body, true);
    var output = pretty((new serializer()).serializeToString(this.newdoc));
    fs.writeFileSync(buildPath("sample-output.html"), output);
    console.log(pretty((new serializer()).serializeToString(this.newdoc)))
}

Walker.prototype.padding = function(num) {
    num = num.toString();
    while (num.length < 3) {
        num = `0${num}`;
    }
    return num;
}

Walker.prototype.getTarget = function() {
    return this.stack.slice(-1)[0];
}

Walker.prototype.addTarget = function(node) {
    this.stack.push(node);
}

Walker.prototype.dropTarget = function() {
    this.stack.pop();
}

Walker.prototype.getJurisdictionMap = function(code) {
    var accByPos = {};
    var accByKey = {};
    
    var _jurisdictionKeySplit = code.split(":");
    var topJurisdiction = _jurisdictionKeySplit[0];
    // console.log(`Loading jurisdiction codes for: ${topJurisdiction}`);
    
    var jurisdictionFile = `juris-${topJurisdiction}-map.json`;
    var jurisdictionJSON = fs.readFileSync(jurisMapPath(jurisdictionFile)).toString();
    var jurisdictionRawData = JSON.parse(jurisdictionJSON);

    var jurisdictionList = jurisdictionRawData.jurisdictions.default;
    accByPos[0] = {
        offset: this.padding(jurisdictionList[0][0].length),
        code: jurisdictionList[0][0],
        name: `${jurisdictionList[0][1]}|${jurisdictionList[0][0].toUpperCase()}`
    }

    for (var i=1,ilen=jurisdictionList.length; i<ilen; i++) {
        var jurisdictionInfo = jurisdictionList[i];
        var parentPos = jurisdictionInfo[2];
        var parentInfo = accByPos[parentPos];
        var code = `${parentInfo.code}:${jurisdictionInfo[0]}`;
        var name = `${parentInfo.name}|${jurisdictionInfo[1]}`;
        accByPos[i] = {
            offset: this.padding(code.length),
            code: code,
            name: name
        }
    }
    for (var pos in accByPos) {
        var info = accByPos[pos];
        accByKey[info.code] = `${info.offset}${info.code}${info.name}`;
    }
    return accByKey;
}

Walker.prototype.appendOrdinaryNode = function(inputNode, outputNode) {
    if (outputNode !== null) {
        if (outputNode) {
		    this.getTarget().appendChild(outputNode);
            this.addTarget(outputNode);
        }
	    for(var i=0; i<inputNode.childNodes.length; i++) {
            var child = inputNode.childNodes[i];
            // console.log(`   child: ${child.textContent}`);
		    this.processInputTree(child);
	    }
        if (outputNode) {
            this.dropTarget();
        }
    }
}

Walker.prototype.getListLevel = function(node) {
    var ret = 0;
    var style = node.getAttribute("style");
    var m = style.match(/level([0-9])/);
    if (m) {
        ret = parseInt(m[1], 10);
    }
    return ret;
}

Walker.prototype.appendOpeningListNode = function(inputNode, outputNode) {
	outputNode = this.newdoc.createElement("ol");
    this.getTarget().appendChild(outputNode);
    this.addTarget(outputNode);
	var li = this.newdoc.createElement("li");
	outputNode.appendChild(li);
    this.addTarget(li);
    this.listLevel = this.getListLevel(inputNode);
    console.log(this.listLevel);
	for(var i=0; i<inputNode.childNodes.length; i++) {
        var child = inputNode.childNodes[i];
		this.processInputTree(child);
	}
    this.dropTarget();
}

Walker.prototype.appendMiddleListNode = function(inputNode, outputNode) {
    var newListLevel = this.getListLevel(inputNode);
    if (newListLevel > this.listLevel) {
        // Does the list level deepen?
        console.log("  deepens");
    } else if (newListLevel < this.listLevel) {
        // Does the list level rise?
        console.log("  rises");
    } else {
        // Level still the same?
        console.log("  same");
    }
    console.log(`  ${newListLevel} / ${this.listLevel}`);
    this.listLevel = newListLevel;
}

Walker.prototype.appendClosingListNode = function(inputNode, outputNode) {
    var newListLevel = this.getListLevel(inputNode);
    if (newListLevel > this.listLevel) {
        // Does the list level deepen?
        console.log("  deepens");
    } else if (newListLevel < this.listLevel) {
        // Does the list level rise?
        console.log("  rises");
    } else {
        // Level still the same?
        console.log("  same");
    }
    this.listLevel = newListLevel;
    var outputNode = this.newdoc.createElement("li");
    this.getTarget().appendChild(outputNode);
    this.addTarget(outputNode);
	for(var i=0; i<inputNode.childNodes.length; i++) {
        var child = inputNode.childNodes[i];
		this.processInputTree(child);
	}
    this.dropTarget();
    this.dropTarget();
}

Walker.prototype.fixNodeAndAppend = function(node) {
    var ret = null;
    var tn = node.tagName;
    var m = tn.match(/(h[0-9]|p|span|table|tr|td|i|li|ul|ol|b)/);
    if (m) {
        
        // OH PIFFLE.
        // I need peace and quiet to sort this mess out. Functions
        // should have a single purpose, side effects should be
        // avoided, and names should clearly identify what each
        // function is for.
        
	    if (m[1] === "p") {
	        ret = this.newdoc.createElement("p");
	        var cls = node.getAttribute("class");
	        if (cls === "Inkling") {
		        ret.setAttribute("class", cls);
                this.appendOrdinaryNode(node, ret)
	        } else if (cls === "MsoListParagraphCxSpFirst") {

		        // Oh! This is hard. We need to set ol, but
		        // then set the first li as the pushNode.
		        // How to do that? Return an array? No, that's
		        // going to fuzz up the logic.

		        // Catch this first node in the main function,
		        // set it, and set it as target there. Then things
		        // unfold as noremal UNTIL we reach
		        // then end. Then what? Tough. Later.
		        console.log("first");
		        
                this.appendOpeningListNode(node, null);
	        } else if (cls === "MsoListParagraphCxSpMiddle") {
		        console.log("middle");
                this.appendMiddleListNode(node, null);
	        } else if (cls === "MsoListParagraphCxSpLast") {
		        console.log("last");

                this.appendClosingListNode(node, null);
            } else {
                this.appendOrdinaryNode(node, ret);
            }
	    } else if (m[1] === "span") {
	        var cls = node.getAttribute("class");
            var dataInfo = node.getAttribute("data-info");
	        var style = node.getAttribute("style");
            // console.log(`${cls} / ${dataInfo} / ${style}`)
            if (style && style.match("small-caps")) {
        	    ret = this.newdoc.createElement("span");
		        ret.setAttribute("class", "small-caps");
            } else if (cls && cls.match("cite") && dataInfo) {
                ret = this.newdoc.createElement(tn);
                ret.setAttribute("class", "cite");
                ret.setAttribute("data-info", dataInfo);
	        } else {
                ret = false;
	        }
            // console.log(`Input node: ${node.nodeName}, Output node: ${ret}`);
            this.appendOrdinaryNode(node, ret)
        } else {
	        ret = this.newdoc.createElement(tn);
            this.appendOrdinaryNode(node, ret)
        }
    }
}

Walker.prototype.fixFieldObj = function(fieldObj) {
    // Fix jurisdiction field values
    for (var itemObj of fieldObj.citationItems) {
        if (itemObj.itemData.jurisdiction) {
            itemObj.itemData.jurisdiction = this.jurisdictionMap[itemObj.itemData.jurisdiction];
        }
        var itemKey = itemObj.uri[0].split("/").pop();
        itemObj.itemData.id = itemKey;
    }
    return fieldObj;
}

Walker.prototype.buildDataInfo = function(fieldObj) {
    var arr = [];

    fieldObj = this.fixFieldObj(fieldObj);
    
    // console.log(JSON.stringify(fieldObj, null, 2));

    for (var citationItem of fieldObj.citationItems) {
 
        var info = [];
        var m = citationItem.prefix.match(this.reverseSignalRex)
        if (m) {
            var prefixSignalCode = this.reverseSignalMap[m[1]];
            info.push(prefixSignalCode);
        } else {
            info.push("none");
        }
        info.push(citationItem.itemData.id);
        var positionCode = "0";
        info.push(positionCode);
        var suppressAuthor = citationItem["suppress-author"] ? "1" : "0";
        info.push(suppressAuthor);
        if (citationItem.locator) {
            info.push(citationItem.locator);
        }
        arr.push(info.join("-"));
    }
    
    var ret = arr.join("++");
    return ret;
}

Walker.prototype.writeItemDataFileOrFiles = function(fieldObj) {
    for (var itemObj of fieldObj.citationItems) {
        var itemData = itemObj.itemData;
        var pth = itemDataPath(`${itemData.id}.json`);
        if (!fs.existsSync(pth)) {
            fs.writeFileSync(pth, JSON.stringify(itemData, null, 2));
            // console.log(`Wrote ${itemData.id}.json`);
        }

    }
}

Walker.prototype.processInputTree = function(node) {
    var type = this.processTypes[node.nodeType];
    if (type === "text") {
	    var content = node.nodeValue.replace(/&nbsp;/g, " ").replace(/¥s+/g, " ");
	    if (content.trim()) {
	        var newnode = this.newdoc.createTextNode(content);
	        this.getTarget().appendChild(newnode);
	    }
    } else if (type === "node") {
	    var style = node.getAttribute("style");
	    if (style && style.match(/mso-list:Ignore/)) return;
        // No singletons. What about BR and HR?
	    if (node.childNodes.length > 0) {

            // There is a dirty trick here. Word HTML output contains
            // a lot of tags that are entirely of no interest to us,
            // as well as span tags with text content that we need,
            // but which themselves generally just amount to clutter.
            // fixNode() returns null for the former, but for the
            // latter it returns false. In the block below, tags that
            // evaluate null are dropped entirely, and tags that
            // evaluate false are not pushed to target, but we descend
            // into their children, if any.
	        this.fixNodeAndAppend(node);
	    }
    } else if (type === "comment") {
        var content = node.nodeValue;
        if (content.slice(0, 19) === "[if supportFields]>" && content.slice(-9) === "<![endif]") {
            // console.log(`Raw: ${content}`);
            content = content.slice(19, -9);
            var fieldDoc = new dom().parseFromString(content, "text/html");
            var fieldBody = xpath.select("//body", fieldDoc)[0];
            var begin = xpath.select('//span[contains(@style, "mso-element:field-begin")]', fieldBody);
            if (begin.length) {
                var fieldJSON = fieldBody.firstChild.textContent.slice(32).replace(/&quot;/g, '"').replace(/(\r\n|\n|\r)/gm, " ").trim();
                var fieldObj = JSON.parse(fieldJSON);

                // Write data file(s) for this citation if required
                var fieldID = this.buildDataInfo(fieldObj);
                this.writeItemDataFileOrFiles(fieldObj);

                // Add wrapper to the citation object in the output DOM
                var wrapper = this.newdoc.createElement("span");
                wrapper.setAttribute("class", "cite");
                wrapper.setAttribute("data-info", fieldID);
                this.fixNodeAndAppend(wrapper);
            }
        }
    }
}

/*
Unfortunately, the Jurism data embedded in the document does not
contain positional information. There's no easy way around that,
since the position parameter is dynamic, and cannot be set
manually through the document UI.

var positionMap = {
    "0": "First reference",
    "1": "Subsequent reference",
    "2": "Id. reference",
    "3": "Id. reference with locator"
};
*/

/*
*/


const walker = new Walker(doc, newdoc);
walker.run();
console.log("Generated files are at build/sample-output.html and under build/static/itemdata");
