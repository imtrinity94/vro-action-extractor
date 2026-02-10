#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { parseStringPromise } from 'xml2js';
import * as path from 'node:path';
import AdmZip from 'adm-zip';

// Helper to clean up file names
function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9\s-_]/g, '_').replace(/\s+/g, '_');
}

async function parseXmlBuffer(buffer) {
    let xml = '';

    // Handle buffer if it's not already a string (xml2js might not like raw buffers if encoding varies)
    if (!Buffer.isBuffer(buffer)) {
        // If it's already a string, just pass it
        return parseStringPromise(buffer, { explicitArray: false, mergeAttrs: true, explicitCharkey: true });
    }

    // Simple BOM detection
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
        // UTF-16BE
        const decoder = new TextDecoder('utf-16be');
        xml = decoder.decode(buffer);
    } else if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
        // UTF-16LE
        const decoder = new TextDecoder('utf-16le');
        xml = decoder.decode(buffer);
    } else {
        // Default to UTF-8
        xml = buffer.toString('utf8');
    }

    return parseStringPromise(xml, { explicitArray: false, mergeAttrs: true, explicitCharkey: true });
}

async function loadXml(file) {
    const buffer = await fs.readFile(file);
    return parseXmlBuffer(buffer);
}

function generateJSDoc(name, inputs, outputs, description) {
    const lines = ['/**'];
    lines.push(` * ${(description || name).trim()}`);
    lines.push(' *');

    if (inputs && inputs.length > 0) {
        inputs.forEach(input => {
            const type = input.type || 'Any';
            const paramName = input.name || input['export-name'];
            const desc = input.description ? ` - ${input.description}` : '';
            lines.push(` * @param {${type}} ${paramName}${desc}`);
        });
    }

    if (outputs && outputs.length > 0) {
        outputs.forEach(output => {
            const type = output.type || 'Any';
            const paramName = output.name || output['export-name'];
            const desc = output.description ? ` - ${output.description}` : '';
            lines.push(` * @return {${type}} ${paramName}${desc}`);
        });
    }

    lines.push(' */');
    return lines.join('\n');
}

function generatePythonDoc(name, inputs, outputs, description) {
    const lines = ['"""'];
    lines.push(`${(description || name).trim()}`);
    lines.push('');

    if (inputs && inputs.length > 0) {
        lines.push('Args:');
        inputs.forEach(input => {
            const type = input.type || 'Any';
            const paramName = input.name || input['export-name'];
            const desc = input.description ? ` - ${input.description}` : '';
            lines.push(`    ${paramName} (${type}): ${desc}`);
        });
        lines.push('');
    }

    if (outputs && outputs.length > 0) {
        lines.push('Returns:');
        outputs.forEach(output => {
            const type = output.type || 'Any';
            const paramName = output.name || output['export-name'];
            const desc = output.description ? ` - ${output.description}` : '';
            lines.push(`    ${type}: ${paramName}${desc}`);
        });
    }

    lines.push('"""');
    return lines.join('\n');
}

function generatePowerShellDoc(name, inputs, outputs, description) {
    const lines = ['<#'];
    lines.push('.SYNOPSIS');
    lines.push(`    ${(description || name).trim()}`);
    lines.push('');
    lines.push('.DESCRIPTION');
    lines.push(`    ${(description || name).trim()}`);
    lines.push('');

    if (inputs && inputs.length > 0) {
        inputs.forEach(input => {
            const type = input.type || 'Any';
            const paramName = input.name || input['export-name'];
            const desc = input.description ? `${input.description}` : '';
            lines.push('.PARAMETER ' + paramName);
            lines.push(`    ${desc} (Type: ${type})`);
        });
    }

    if (outputs && outputs.length > 0) {
        lines.push('.OUTPUTS');
        outputs.forEach(output => {
            const type = output.type || 'Any';
            const paramName = output.name || output['export-name'];
            const desc = output.description ? `${output.description}` : '';
            lines.push(`    ${type} - ${paramName} ${desc}`);
        });
    }

    lines.push('#>');
    return lines.join('\n');
}

function generateDoc(runtime, name, inputs, outputs, description) {
    if (runtime === 'python') {
        return generatePythonDoc(name, inputs, outputs, description);
    } else if (runtime === 'powershell') {
        return generatePowerShellDoc(name, inputs, outputs, description);
    } else {
        return generateJSDoc(name, inputs, outputs, description);
    }
}

function extractScriptData(item) {
    // Check if it is a task and has a script
    if (item.type !== 'task' || !item.script) {
        return null;
    }

    // Prepare inputs/outputs
    const inBindings = item['in-binding']?.bind || [];
    const inputs = Array.isArray(inBindings) ? inBindings : [inBindings];

    const outBindings = item['out-binding']?.bind || [];
    const outputs = Array.isArray(outBindings) ? outBindings : [outBindings];

    // Script content often inside <script ...> ... </script>.
    // In xml2js with explicitCharkey:true, text content is in ._
    let code = item.script._ || '';

    // Remove CDATA markers if present (xml2js usually handles this but good to be safe)
    code = code.replace(/^<!\[CDATA\[|\]\]>$/g, '');

    // Check for runtime in task attributes or infer from code
    let runtime = 'javascript'; // default
    if (item.script['@'] && item.script['@']['encoded']) {
        // sometimes encoded attribute is present, but valid checking is usually elsewhere
    }

    // Attempt to detect runtime from content or tags
    // 1. Check for explicit runtime attribute if available in future XML versions
    // 2. heuristic check
    if (code.includes('import sys') || code.includes('def handler') || code.includes('#!/usr/bin/env python')) {
        runtime = 'python';
    } else if (code.includes('Write-Host') || code.includes('Get-Item') || code.includes('$')) {
        // Very basic check, might get false positives with JS string interpolation if not careful,
        // but $var is typical PS. JS uses var/let/const.
        // A better check for PS:
        if (code.match(/^\s*\$/m) || code.includes('Write-Output')) {
            runtime = 'powershell';
        }
    } else if (code.includes('exports.handler')) {
        runtime = 'nodejs';
    }

    return {
        id: item.id || 'unknown_id', // Capture ID for logging
        name: item.name || item['display-name']?._ || 'unknown_task',
        displayName: item['display-name']?._ || item.name,
        description: item.description?._ || '',
        code: code,
        inputs: inputs.filter(i => i && i.name),
        outputs: outputs.filter(i => i && i.name),
        runtime: runtime
    };
}

async function processActionObj(action, outputDir) {
    // Extract Action Data from dunes-script-module
    let code = action.script?._ || '';
    code = code.replace(/^<!\[CDATA\[|\]\]>$/g, '');

    // Runtime
    let runtime = 'javascript';
    if (action.runtime && action.runtime._) {
        // data format: "python:3.7" or "powercli:11"?
        const rtStr = action.runtime._.toLowerCase();
        if (rtStr.includes('python')) runtime = 'python';
        else if (rtStr.includes('powershell') || rtStr.includes('powercli')) runtime = 'powershell';
        else if (rtStr.includes('node')) runtime = 'nodejs';
        else if (rtStr.includes('javascript')) runtime = 'javascript';
    } else {
        // Heuristics fallback
        if (code.includes('import sys') || code.includes('def handler')) runtime = 'python';
        else if (code.includes('Write-Host') || code.includes('$')) runtime = 'powershell';
        else if (code.includes('exports.handler')) runtime = 'nodejs';
    }

    // Inputs
    // Params are in <param n="..." t="..." />
    const params = action.param || [];
    const inputs = Array.isArray(params) ? params : [params];
    const formattedInputs = inputs.map(p => ({ name: p.n, type: p.t, description: p.description?._ }));

    // Output
    // Result type is in attributes
    const resultType = action['result-type'] || 'void';
    const outputs = [{ name: 'result', type: resultType, description: 'Action Result' }];

    const info = {
        name: action.name || 'Unnamed_Action',
        description: action.description?._ || '',
        displayName: action.name
    };

    const doc = generateDoc(runtime, info.displayName, formattedInputs, outputs, info.description);
    const fileContent = `${doc}\n${code}`;

    const saneName = sanitizeFilename(info.name);

    // Determine extension
    let ext = '.js';
    if (runtime === 'python') ext = '.py';
    if (runtime === 'powershell') ext = '.ps1';

    const outFileName = `${saneName}${ext}`;
    const outPath = path.join(outputDir, outFileName);

    try {
        await fs.access(outputDir);
    } catch {
        await fs.mkdir(outputDir, { recursive: true });
    }

    await fs.writeFile(outPath, fileContent, 'utf8');
    console.log(`Extracted Action: ${outFileName} (${runtime})`);
    return 1;
}

// Core logic to extract actions from a loaded Workflow Object
async function processWorkflowObj(workflowObj, outputDir) {
    const createdFiles = new Set();

    // Find workflow root
    const rootKey = Object.keys(workflowObj)[0];
    const root = workflowObj[rootKey];

    if (rootKey === 'dunes-script-module') {
        return processActionObj(root, outputDir);
    }

    // Items can be workflow-item or workflowItem depending on version/parser strictness?
    // Usually workflow-item.
    const rawItems = root['workflow-item'] ?? root['workflowItem'] ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    let count = 0;
    let dirCreated = false;

    const skippedItems = [];

    for (const item of items) {
        const scriptData = extractScriptData(item);
        if (scriptData && scriptData.code.trim()) {
            const doc = generateDoc(scriptData.runtime, scriptData.displayName, scriptData.inputs, scriptData.outputs, scriptData.description);
            const fileContent = `${doc}\n${scriptData.code}`;

            const saneName = sanitizeFilename(scriptData.displayName || scriptData.name);

            // Determine extension
            let ext = '.js';
            if (scriptData.runtime === 'python') ext = '.py';
            if (scriptData.runtime === 'powershell') ext = '.ps1';

            let outFileName = `${saneName}${ext}`;

            // Handle collisions (local to this workflow processing)
            let collisionCount = 1;
            while (createdFiles.has(outFileName)) {
                outFileName = `${saneName}_${collisionCount}${ext}`;
                collisionCount++;
            }
            createdFiles.add(outFileName);

            const outPath = path.join(outputDir, outFileName);

            if (!dirCreated) {
                try {
                    await fs.access(outputDir);
                } catch {
                    await fs.mkdir(outputDir, { recursive: true });
                }
                dirCreated = true;
            }

            await fs.writeFile(outPath, fileContent, 'utf8');
            console.log(`Extracted: ${outFileName} (${scriptData.runtime})`);
            count++;
        } else {
            // Log skipped item
            const name = item['display-name']?._ || item.name || 'Unnamed Item';
            const id = item.id || 'No ID';
            let reason = 'Unknown';
            if (item.type !== 'task') reason = `Type is '${item.type}', not 'task'`;
            else if (!item.script) reason = 'No script element found';
            else if (scriptData && !scriptData.code.trim()) reason = 'Empty script content';

            skippedItems.push({ id, name, reason });
        }
    }

    if (skippedItems.length > 0) {
        console.log(`\n--- Skipped Items in ${root['display-name']?._ || 'Workflow'} ---`);
        skippedItems.forEach(skip => {
            console.log(`[SKIPPED] ID: ${skip.id} | Name: "${skip.name}" | Reason: ${skip.reason}`);
        });
        console.log('--------------------------------------------------\n');
    }

    return count;
}

// Convert a single XML file (standard mode)
async function convertWorkflow(filePath, outputRoot) {
    // console.log(`Processing file: ${filePath}`); // Too verbose if processing many files
    try {
        const workflowObj = await loadXml(filePath);

        // Inspect object to determine path
        const rootKey = Object.keys(workflowObj)[0];
        let wfName = 'Unnamed';
        let isAction = false;
        let actionGroup = '';

        if (rootKey === 'workflow') {
            const workflowRoot = workflowObj['workflow'];
            wfName = workflowRoot['name'] || workflowRoot['display-name'] || workflowRoot['@']?.['name'] || 'Unnamed_Workflow';
        } else if (rootKey === 'dunes-script-module') {
            isAction = true;
            const actionRoot = workflowObj['dunes-script-module'];
            wfName = actionRoot['name'] || actionRoot['@']?.['name'] || 'Unnamed_Action';
            actionGroup = actionRoot.group || actionRoot['@']?.group || '';
        } else {
            return { success: false, reason: `Unknown root element: ${rootKey}` };
        }

        // Handle CDATA
        if (typeof wfName === 'object' && wfName._) wfName = wfName._;
        if (typeof actionGroup === 'object' && actionGroup._) actionGroup = actionGroup._;

        const saneWfName = sanitizeFilename(wfName);
        let outputDir;

        if (isAction) {
            // Flatten Actions: always extract to Actions/ folder directly
            outputDir = path.join(outputRoot, 'Actions');
        } else {
            outputDir = path.join(outputRoot, 'Workflows', saneWfName);
        }

        console.log(`Extracting ${isAction ? 'Action' : 'Workflow'}: "${wfName}" -> ${outputDir}`);
        const count = await processWorkflowObj(workflowObj, outputDir);
        return { success: true, count: count, name: wfName };

    } catch (err) {
        // console.error("Error converting workflow:", err);
        return { success: false, reason: err.message };
    }
}

// Convert a .package (zip) file
async function convertPackage(filePath) {
    console.log(`Processing Package: ${filePath} ...`);

    const stats = { found: 0, extracted: 0, skipped: 0, errors: [] };

    try {
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();

        for (const entry of zipEntries) {
            const parts = entry.entryName.split('/');
            // Pattern: elements/UUID/data
            if (parts.length >= 3 && parts[0] === 'elements' && parts[parts.length - 1] === 'data') {
                stats.found++;
                try {
                    const buffer = entry.getData();
                    if (!buffer || buffer.length === 0) throw new Error("Empty buffer");

                    let workflowObj;
                    try {
                        workflowObj = await parseXmlBuffer(buffer);
                    } catch (e) {
                        // Likely not XML, e.g. binary data or signature file
                        throw new Error(`Invalid XML: ${e.message}`);
                    }

                    const rootKey = Object.keys(workflowObj)[0];
                    let wfName = 'Unnamed';
                    let isAction = false;
                    let actionGroup = '';

                    if (rootKey === 'workflow') {
                        const workflowRoot = workflowObj['workflow'];
                        wfName = workflowRoot['name'] || workflowRoot['display-name'] || workflowRoot['@']?.['name'] || 'Unnamed_Workflow';
                    } else if (rootKey === 'dunes-script-module') {
                        isAction = true;
                        const actionRoot = workflowObj['dunes-script-module'];
                        wfName = actionRoot['name'] || actionRoot['@']?.['name'] || 'Unnamed_Action';
                        actionGroup = actionRoot.group || actionRoot['@']?.group || '';
                    } else {
                        // Skip silently or log debug
                        continue;
                    }

                    if (typeof wfName === 'object' && wfName._) wfName = wfName._;
                    if (typeof actionGroup === 'object' && actionGroup._) actionGroup = actionGroup._;

                    const saneWfName = sanitizeFilename(wfName);
                    const packageDir = path.dirname(filePath);
                    let outputDir;

                    if (isAction) {
                        // Flatten Actions: always extract to Actions/ folder directly
                        outputDir = path.join(packageDir, 'Actions');
                    } else {
                        // Workflows get their own folder
                        outputDir = path.join(packageDir, 'Workflows', saneWfName);
                    }

                    console.log(`[Extracting] ${isAction ? 'Action' : 'Workflow'}: "${wfName}"`);
                    const count = await processWorkflowObj(workflowObj, outputDir);
                    if (count > 0) stats.extracted += count;
                    else stats.skipped++;

                } catch (err) {
                    // stats.errors.push({ entry: entry.entryName, error: err.message });
                    // Only log if it's a "real" error, not just "Non-whitespace before first tag" for known junk
                    if (!err.message.includes('Non-whitespace before first tag')) {
                        console.error(`  [Warning] ${entry.entryName}: ${err.message}`);
                        stats.errors.push(`${entry.entryName}: ${err.message}`);
                    }
                }
            }
        }

        console.log(`\n--- Package Summary for ${path.basename(filePath)} ---`);
        console.log(`Found Elements: ${stats.found}`);
        console.log(`Extracted Scripts: ${stats.extracted}`);
        if (stats.errors.length > 0) {
            console.log(`Errors: ${stats.errors.length}`);
            // stats.errors.forEach(e => console.log(` - ${e}`));
        }
        console.log('--------------------------------------------------\n');

    } catch (err) {
        console.error("Error processing package:", err);
    }
}

async function fileExists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

// Recursively find files with a specific extension or specific name
async function findTargets(dir) {
    let results = [];
    const list = await fs.readdir(dir);
    for (const file of list) {
        // Skip signature folders to avoid processing non-XML data
        if (file.toLowerCase() === 'signatures') {
            continue;
        }

        const filePath = path.join(dir, file);
        const stat = await fs.stat(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(await findTargets(filePath));
        } else {
            // Check for .xml extension OR exact match 'data' OR .package
            if (file.toLowerCase().endsWith('.xml') || file === 'data' || file.toLowerCase().endsWith('.package')) {
                results.push(filePath);
            }
        }
    }
    return results;
}

// CLI Entry Point
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.error("Usage: vro-extract <path_to_workflow_xml_or_directory_or_package>");
        process.exit(1);
    }

    const inputPath = args[0];

    try {
        await fs.access(inputPath);
    } catch (err) {
        console.error(`Error: Input path not found: '${inputPath}'`);
        process.exit(1);
    }

    try {
        const stat = await fs.stat(inputPath);

        // Single package file
        if (!stat.isDirectory() && inputPath.toLowerCase().endsWith('.package')) {
            await convertPackage(inputPath);
            return;
        }

        // Processing directory or single XML
        let targets = [];
        if (stat.isDirectory()) {
            console.log(`Scanning directory: ${inputPath} ...`);
            targets = await findTargets(inputPath);
            console.log(`Found ${targets.length} target files (.xml, .package or 'data').`);
        } else {
            targets = [inputPath];
        }

        const taskStats = {
            processed: 0,
            succeeded: 0,
            failed: 0,
            extractedScripts: 0,
            skipped: 0
        };

        for (const file of targets) {
            if (file.toLowerCase().endsWith('.package')) {
                await convertPackage(file);
                // We don't aggregate package stats into taskStats easily because convertPackage wraps its own, 
                // but that's acceptable.
                continue;
            }

            // Determine output root
            let outputRoot;
            if (stat.isDirectory()) {
                // Pass the parent directory (or the folder containing 'data') as the root
                outputRoot = path.dirname(file);
            } else {
                outputRoot = args[1];
                if (!outputRoot) outputRoot = path.dirname(inputPath);
            }

            const result = await convertWorkflow(file, outputRoot);
            taskStats.processed++;

            if (result && result.success) {
                taskStats.succeeded++;
                taskStats.extractedScripts += result.count;
                if (result.count === 0) taskStats.skipped++;
            } else {
                taskStats.failed++;
                // Optional: log failure reason if not already logged? 
                // It is logged in convertWorkflow now as console.error? No, I commented it out there.
                // Let's log it here for visibility
                // But filtering common non-errors
                if (result && result.reason && !result.reason.includes('Non-whitespace before first tag')) {
                    console.log(`[Failed] ${path.basename(file)}: ${result.reason}`);
                }
            }
        }

        if (targets.length > 0 && !targets[0].toLowerCase().endsWith('.package')) {
            console.log(`\n--- Execution Summary ---`);
            console.log(`Files Processed:   ${taskStats.processed}`);
            console.log(`Successful:        ${taskStats.succeeded}`);
            console.log(`Failed/Skipped:    ${taskStats.failed}`);
            console.log(`Scripts Extracted: ${taskStats.extractedScripts}`);
            console.log('-------------------------\n');
        }

    } catch (err) {
        console.error("Fatal Error:", err.message);
        if (err.code === 'ENOENT') {
            console.error("Hint: Please check if the file path is correct.");
        }
    }
}

main();