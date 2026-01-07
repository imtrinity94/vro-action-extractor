/**
 * Simple task with custom script capability.
 *
 * @param {string} get_contentAsString
 * @return {string} post_pathUri
 * @return {string} post_payload
 */
// Calling Logger module
var logger = new (System.getModule("logging").Logger())("Workflow", workflow.currentWorkflow.name+"/"+System.currentWorkflowItem().getDisplayName());
logger.info("*** Preparing Inputs for POST Operation ***");

var deploymentJson = JSON.parse(get_contentAsString);
if (!deploymentJson) {
    throw "Deployment JSON response is null or undefined.";
}

// Parse the deployment details
var parsedJson = deploymentJson;
var catalogId = parsedJson.catalogItemId;  // Catalog item ID for the deployment
var inputs = parsedJson.inputs;  // Inputs for the deployment
var blueprintId = parsedJson.blueprintId;  // Blueprint ID for blueprint-based deployments

// Create a new deployment name, modifying the original name if it contains "Failed" and add current unix datetime
var deploymentName = parsedJson.name.split("Failed")[0].split("(")[0] + " - resubmitted @ " + Date.now();
logger.info("Deployment name: " + deploymentName);

// Get the project ID for the deployment
var projectId = parsedJson.projectId;
logger.info("Project ID: " + projectId);

// Determine which API endpoint to use based on whether this is a catalog item or blueprint
if (catalogId && catalogId.trim() !== "") {
    // Catalog-based deployment
    logger.info("Catalog ID found: " + catalogId + " - using catalog API");
    
    // Construct the payload for catalog request
    var payload = {
        "deploymentName": deploymentName,
        "bulkRequestCount": 1,
        "reason": "Resubmitted Request via Day-2 action",
        "inputs": inputs,
        "projectId": projectId
    };
    
    var opUrl = "/catalog/api/items/" + catalogId + "/request";
    logger.info("Catalog API URL: " + opUrl);
} else if (blueprintId && blueprintId.trim() !== "") {
    // Blueprint-based deployment
    logger.info("No Catalog ID found, using Blueprint ID: " + blueprintId + " - using blueprint API");
    
    // Construct the payload for blueprint request
    var payload = {
        "deploymentId": null,
        "deploymentName": deploymentName,
        "description": "",
        "plan": false,
        "blueprintId": blueprintId,
        "content": null,
        "inputs": inputs,
        "simulate": false
    };
    
    var opUrl = "/blueprint/api/blueprint-requests?apiVersion=2019-09-12";
    logger.info("Blueprint API URL: " + opUrl);
} else {
    throw "Neither catalogItemId nor blueprintId found in the deployment JSON";
}

// Log the final payload
logger.info("Final payload: " + JSON.stringify(payload));

// Set variables for the next step
post_pathUri = opUrl;
post_payload = JSON.stringify(payload);