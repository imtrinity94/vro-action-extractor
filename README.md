# vro-action-extractor
[![npm version](https://badge.fury.io/js/vro-action-extractor.svg)](https://badge.fury.io/js/vro-action-extractor)

A Universal CLI tool to extract Scriptable Actions from vRealize Orchestrator (vRO) / VMware Aria Automation Orchestrator environments. It converts Workflows, Packages, and Folder structures into clean code files with automated documentation generation.

## Features

- **Polyglot Extraction**: Extracts code for multiple runtimes:
    - **JavaScript / Node.js** (`.js`)
    - **Python** (`.py`)
    - **PowerShell / PowerCLI** (`.ps1`)
- **Smart Documentation**: Generates language-specific documentation automatically:
    - **JSDoc** for JavaScript (`/** ... */`)
    - **Docstrings** for Python (`""" ... """`)
    - **Comment-Based Help** for PowerShell (`<# ... #>`)
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
*Creates `Actions` and `Workflows` folders in the same directory as the package.*

### 2. Extract from a Directory (e.g., Git Repo)

```bash
vro-extract "path/to/project_root"
```
*Scans for all valid `data` and `.xml` files recursively and extracts them into `Actions` and `Workflows` folders relative to their source.*

### 3. Extract from Single XML

```bash
vro-extract "path/to/workflow.xml" [output_directory]
```

## Folder Structure & Examples

The tool organizes extracted scripts into **Actions** and **Workflows** directories.

### Output Structure

```
.
├── Actions/
│   └── com/
│       └── vmware/
│           └── library/
│               └── myAction.js          (Action: com.vmware.library.myAction)
│               └── utilAction.py        (Action: com.vmware.library.utilAction)
└── Workflows/
    └── My_Complex_Workflow/
        ├── Validate_Inputs.js           (Scriptable Task)
        └── Call_External_API.py         (Scriptable Task)
```

### Input vs Output

| Input Source | Output Location | Structure |
|--------------|-----------------|-----------|
| **Package** (`my.package`) | `./Actions/` <br> `./Workflows/` | Actions are grouped by namespace (e.g. `com/group/name`). Workflows are in named folders. |
| **Directory** (`./src`) | `./src/Actions/` <br> `./src/Workflows/` | recursive extraction relative to found files. |
| **Single Workflow** (`wf.xml`) | `./Workflows/Wf_Name/` | Creates a folder for the workflow relative to the input file. |
| **Single Action** (`action.xml`) | `./Actions/com/group/` | Creates the group hierarchy relative to the input file. |

## License

MIT
