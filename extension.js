// Last edited by kieran.van.der.heijde@asml.com @ 28/05/25 18:23.
const vscode = require('vscode');
const minimatch = require('minimatch');
const fs = require('fs');
const path = require('path');

const config = vscode.workspace.getConfiguration('autoSign');

let timeout;
let uri;

function formatDate() {
    let date = new Date()

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yy = String(date.getFullYear()).slice(-2);

    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');

    return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

let liscenses = {
"MIT":
`Copyright <YEAR> <HOLDER>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`,
"Apache-2.0":
`Copyright <YEAR> <HOLDER>

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
`
}

async function ensureLicenseFile() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('No workspace folder is open.');
    return;
  }

  const rootPath = folders[0].uri.fsPath;
  const licensePath = path.join(rootPath, 'LICENSE');

  try {
    await fs.promises.access(licensePath, fs.constants.F_OK);
  } catch {
    let licenseContent;

    if (config.get("licensePreset") == "Custom") {
        licenseContent = config.get("customLicenseText")
    } else {
        licenseContent = liscenses[config.get("licensePreset")]
    }

    licenseContent = licenseContent.replace("<YEAR>", new Date().getFullYear())
    licenseContent = licenseContent.replace("<HOLDER>", config.get("email"))

    try {
      await fs.promises.writeFile(licensePath, licenseContent, 'utf8');
      vscode.window.showInformationMessage('License file created!');
    } catch (writeErr) {
      vscode.window.showErrorMessage('Failed to create license file: ' + writeErr.message);
    }
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    let lastEditor = vscode.window.activeTextEditor;

	const disposable = vscode.commands.registerCommand('autosign.sign', async function () {
		const editor = vscode.window.activeTextEditor;

        await ensureLicenseFile()

        if (editor) {
			const document = editor.document;
            const originalSelections = editor.selections.map(sel => sel);
            const scrollAnchor = editor.visibleRanges[0].start;

            const anchorDecorationType = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                opacity: '0',
                });
            editor.setDecorations(anchorDecorationType, [new vscode.Range(scrollAnchor, scrollAnchor)]);

            editor.edit(editBuilder => {
                if (editor.document.lineAt(0).text.includes("Last edited by")) {
                    editBuilder.delete(document.lineAt(0).rangeIncludingLineBreak);
                }

                editBuilder.insert(new vscode.Position(0, 0), `Last edited by ${config.get("email")} @ ${formatDate()}.\n`);
            });

            const topLine = document.lineAt(0);
            editor.selections = [new vscode.Selection(topLine.range.start, topLine.range.end)];

            await vscode.commands.executeCommand('editor.action.commentLine');

            editor.selections = originalSelections;

            setTimeout(() => {
                editor.revealRange(
                    new vscode.Range(scrollAnchor, scrollAnchor),
                    vscode.TextEditorRevealType.AtTop
                );
                
                setTimeout(() => {
                    editor.setDecorations(anchorDecorationType, []);
                    anchorDecorationType.dispose();
                }, 500);
            }, 50);
        } else {
            vscode.window.showInformationMessage('No active editor found!');
        }
	});

	const changeListener = vscode.workspace.onDidChangeTextDocument(async function (event) {
        const document = event.document;
        const editor = vscode.window.activeTextEditor;
        uri = document.uri; 

        if (timeout) {
            clearTimeout(timeout);
            timeout = null
        }

        const filePath = editor.document.uri.fsPath;
        const patterns = config.get("ignore")

        if (patterns.some(pattern => minimatch.minimatch(filePath, pattern, { matchBase: true })) | !config.get("canAutoSign")) {
            return
        }

        timeout = setTimeout(async () => {
            for (const change of event.contentChanges) {
                console.log(!change.text.includes("Last edited by") & change.range.start.line != 0)
                if (!change.text.includes("Last edited by") & change.range.start.line != 0) {
                    const doc = await vscode.workspace.openTextDocument(uri);

                    const textEditor = await vscode.window.showTextDocument(doc, { preview: false });

                    await vscode.commands.executeCommand('autosign.sign');
                }
        }
        }, config.get("signDelay") * 1000);
    });

    const onChange = vscode.window.onDidChangeActiveTextEditor(async function(newEditor) {
        if (!newEditor | !lastEditor) {
            return
        }

        if (newEditor.document.uri.toString() !== lastEditor.document.uri.toString() && timeout) {
            clearTimeout(timeout)
            timeout = null

            const doc = await vscode.workspace.openTextDocument(uri);
            const doc2 = await vscode.workspace.openTextDocument(newEditor.document.uri);
            await vscode.window.showTextDocument(doc, { preview: false });

            await vscode.commands.executeCommand('autosign.sign');

            setTimeout(async () => {await vscode.window.showTextDocument(doc2, { preview: false });},
                10
            )
        }
        lastEditor = newEditor;
    });

	context.subscriptions.push(disposable);
	context.subscriptions.push(changeListener);
    context.subscriptions.push(onChange);
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
}