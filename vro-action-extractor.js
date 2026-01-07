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

    return {
        name: item.name || item['display-name']?._ || 'unknown_task',
        displayName: item['display-name']?._ || item.name,
        description: item.description?._ || '',
        code: code,
        inputs: inputs.filter(i => i && i.name),
        outputs: outputs.filter(i => i && i.name)
    };
}

// Core logic to extract actions from a loaded Workflow Object
async function processWorkflowObj(workflowObj, outputDir) {
    const createdFiles = new Set();

    // Find workflow root
    const rootKey = Object.keys(workflowObj)[0];
    const root = workflowObj[rootKey];

    // Items can be workflow-item or workflowItem depending on version/parser strictness?
    // Usually workflow-item.
    const rawItems = root['workflow-item'] ?? root['workflowItem'] ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    let count = 0;
    let dirCreated = false;

    for (const item of items) {
        const scriptData = extractScriptData(item);
        if (scriptData && scriptData.code.trim()) {
            const jsDoc = generateJSDoc(scriptData.displayName, scriptData.inputs, scriptData.outputs, scriptData.description);
            const fileContent = `${jsDoc}\n${scriptData.code}`;

            const saneName = sanitizeFilename(scriptData.displayName || scriptData.name);
            let outFileName = `${saneName}.js`;

            // Handle collisions (local to this workflow processing)
            let collisionCount = 1;
            while (createdFiles.has(outFileName)) {
                outFileName = `${saneName}_${collisionCount}.js`;
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
            console.log(`Extracted: ${outFileName}`);
            count++;
        }
    }
    return count;
}

// Convert a single XML file (standard mode)
async function convertWorkflow(filePath, outputDir) {
    console.log(`Processing file: ${filePath}`);
    try {
        const workflowObj = await loadXml(filePath);
        const count = await processWorkflowObj(workflowObj, outputDir);
        console.log(`Done. Extracted ${count} scripts.`);
    } catch (err) {
        console.error("Error converting workflow:", err);
    }
}

// Convert a .package (zip) file
async function convertPackage(filePath) {
    console.log(`Processing Package: ${filePath} ...`);
    try {
        // Zip processing is synchronous in adm-zip usually, but we can treat buffers.
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries(); // an array of ZipEntry records

        let totalScripts = 0;

        for (const entry of zipEntries) {
            // Looking for elements/[UUID]/data
            // Pattern: elements/UUID/data
            const parts = entry.entryName.split('/');
            // Expecting: elements, UUID, data (3 parts) roughly, or just ending in /data and inside elements
            if (parts.length >= 3 && parts[0] === 'elements' && parts[parts.length - 1] === 'data') {
                try {
                    const buffer = entry.getData();
                    const workflowObj = await parseXmlBuffer(buffer);

                    // Check if it's a workflow
                    const rootKey = Object.keys(workflowObj)[0];
                    if (rootKey !== 'workflow') {
                        continue; // Not a workflow element (could be resource, etc)
                    }
                    const workflowRoot = workflowObj['workflow'];

                    // Extract Workflow Name
                    // usually <display-name>
                    let wfName = workflowRoot['display-name'] || workflowRoot['@']?.['name'] || 'Unnamed_Workflow';
                    // Handle CDATA object in xml2js ({ _: "Name" })
                    if (typeof wfName === 'object' && wfName._) {
                        wfName = wfName._;
                    }

                    const saneWfName = sanitizeFilename(wfName);

                    // Output: "a folder on top hierarchy with sub folder naming the workflow name"
                    // We'll interpret this as: [Package_Dir]/Extracted_Actions/[Workflow_Name]/
                    const packageDir = path.dirname(filePath);
                    const outputDir = path.join(packageDir, 'Extracted_Actions', saneWfName);

                    console.log(`Found Workflow in package: "${wfName}". Extracting to: ${outputDir}`);

                    const count = await processWorkflowObj(workflowObj, outputDir);
                    totalScripts += count;
                } catch (err) {
                    console.error(`Failed to process entry ${entry.entryName}:`, err);
                }
            }
        }
        console.log(`Package processing complete. Total scripts extracted: ${totalScripts}`);

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
    const stat = await fs.stat(inputPath);

    if (stat.isDirectory()) {
        console.log(`Scanning directory: ${inputPath} ...`);
        const targetFiles = await findTargets(inputPath);
        console.log(`Found ${targetFiles.length} target files (.xml, .package or 'data').`);

        for (const file of targetFiles) {
            if (file.toLowerCase().endsWith('.package')) {
                await convertPackage(file);
            } else {
                const fileName = path.basename(file);
                let outputDir;

                if (fileName === 'data') {
                    // For package structure: .../elements/[ID]/data
                    // We create an 'actions' folder next to the data file
                    outputDir = path.join(path.dirname(file), 'actions');
                } else {
                    // Standard XML file: .../foo.xml -> .../foo/
                    const baseName = path.basename(file, path.extname(file));
                    outputDir = path.join(path.dirname(file), baseName);
                }

                await convertWorkflow(file, outputDir);
            }
        }
    } else {
        // Single file mode
        if (inputPath.toLowerCase().endsWith('.package')) {
            await convertPackage(inputPath);
        } else {
            let outputDir = args[1];
            if (!outputDir) {
                const fileName = path.basename(inputPath);
                if (fileName === 'data') {
                    outputDir = path.join(path.dirname(inputPath), 'actions');
                } else {
                    const baseName = path.basename(inputPath, path.extname(inputPath));
                    outputDir = path.join(path.dirname(inputPath), baseName);
                }
            }
            await convertWorkflow(inputPath, outputDir);
        }
    }
}

main();