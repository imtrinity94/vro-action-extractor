/**
 * Simple task with custom script capability.
 *
 * @return {string} get_pathUrl
 */
// Calling Logger module
var logger = new (System.getModule("logging").Logger())("Workflow", workflow.currentWorkflow.name+"/"+System.currentWorkflowItem().getDisplayName());
logger.info("*** Preparing Inputs for GET Operation ***");
var deploymentId = System.getContext().getParameter("__metadata_deploymentId");
// deploymentId = "43d1b63d-5588-4a85-9b4e-defba43f94d5";
var opUrl = "/deployment/api/deployments/"+deploymentId+"?expandResources=true&expandLastRequest=true";
inputHeaders = new Properties();
inputHeaders.put("Content-Type","application/json");
get_pathUrl = opUrl;