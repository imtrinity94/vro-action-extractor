# vro-action-extractor

A Universal CLI tool to extract Scriptable Actions from vRealize Orchestrator (vRO) / VMware Aria Automation Orchestrator environments. It converts Workflows, Packages, and Folder structures into clean JavaScript files with automated JSDoc generation.

## Features

- **Extract Actions**: Pulls code from "Scriptable task" items.
- **Auto JSDoc**: Generates inputs/outputs/description headers automatically.
- **Universal Import**: Supports multiple source formats:
  - **.package Files**: Direct extraction from vRO exports (Zip).
  - **Directory Structures**: Recursively scans folders (e.g., from a Git repo).
  - **Flat XMLs**: Individual workflow files.
- **Smart Naming**: Uses display names for coherent file naming.
- **Conflict Resolution**: Handles duplicate action names automatically.

## Installation

```bash
npm install -g vro-action-extractor
```

## Usage

The tool exposes the `vro-extract` command:

### 1. Extract from a Package File

```bash
vro-extract "path/to/my-package.package"
```
*Creates an `Extracted_Actions` folder with organized subfolders.*

### 2. Extract from a Directory (e.g., Git Repo)

```bash
vro-extract "path/to/project_root"
```
*Scans for all valid `data` and `.xml` files recursively.*

### 3. Extract from Single XML

```bash
vro-extract "path/to/workflow.xml" [output_directory]
```

## Example output

```
Extracted_Actions/
  ├── My_Workflow/
  │   ├── Validate_Inputs.js
  │   └── Call_API.js
  └── Another_Workflow/
      └── Send_Notification.js
```

## License

MIT
