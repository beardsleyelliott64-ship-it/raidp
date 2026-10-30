const fs = require("fs").promises;
const path = require("path");
const curlRequesticator = require('../../../../utils/curlRequesticator');
const { spawn } = require('child_process');

function runXeLaTeX(texFilename, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn('xelatex', [
            '-interaction=nonstopmode',
            texFilename
        ], { cwd });

        let stderr = '';

        proc.stderr.on('data', d => {
            stderr += d.toString();
        });

        proc.on('error', reject);

        proc.on('close', code => {
            if (code === 0) return resolve();
            reject(new Error(`xelatex exited with ${code}\n${stderr}`));
        });
    });
}

class Image_Requesticator extends curlRequesticator {
    constructor() {
        super();
        this.headers = [
            'accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'accept-language: en-GB,en;q=0.9,en-US;q=0.8',
            'origin: https://maths.sparx-learning.com/',
            'referer: https://maths.sparx-learning.com/',
            'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36'
        ];
    }
    async sendRequest(url) {
        return this._executeCurl(url, this.headers, undefined, { responseType: 'arraybuffer' });
    }
}
const ImageReq = new Image_Requesticator();

/** 
 * HELPER FUNCTIONS 
 */
async function fileExists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}

async function downloadImage(url, filename) {
    try {
        const buffer = await ImageReq.sendRequest(url);
        await fs.writeFile(filename, Buffer.from(buffer));
        return true;
    } catch { return false; }
}

/**
 * LATEX SAFE FORMATTING
 */
function latexSafe(str) {
    if (!str) return "";
    
    const mathBlocks = [];
    // 1. Mask math blocks to protect them
    let maskedStr = String(str).replace(/\$(.*?)\$/g, (match) => {
        mathBlocks.push(match);
        return `@@MATHBLOCK${mathBlocks.length - 1}@@`;
    });

    // 2. Escape LaTeX special characters FIRST (&, %, #, _, {, })
    maskedStr = maskedStr.replace(/([&%#_{}])/g, "\\$1")
                         .replace(/\^/g, "\\textasciicircum{}")
                         .replace(/~/g, "\\textasciitilde{}");

    // 3. Handle Unicode math, currency, and Sparx pseudo-LaTeX
    maskedStr = maskedStr
        .replace(/\\gt/g, "$>$")
        .replace(/\\lt/g, "$<$")
        .replace(/≤/g, "$\\le$ ")
        .replace(/≥/g, "$\\ge$ ")
        .replace(/°/g, "$^\\circ$") // Degree symbol fix
        .replace(/π/g, "$\\pi$")    // Pi fix
        .replace(/θ/g, "$\\theta$") // Theta fix
        .replace(/×/g, "$\\times$") // Multiply fix
        .replace(/÷/g, "$\\div$")   // Divide fix
        .replace(/£/g, "\\pounds{} ");

    // 4. Apply markdown bold AFTER escaping {} so we don't break the latex command
    maskedStr = maskedStr.replace(/\*\*(.*?)\*\*/g, "\\textbf{$1}"); 

    // 5. Restore math blocks
    mathBlocks.forEach((block, i) => {
        maskedStr = maskedStr.replace(new RegExp(`@@MATHBLOCK${i}@@`, 'g'), () => block);
    });

    return maskedStr;
}

/**
 * CONTENT PROCESSOR
 */
async function processQuestion(val, imgDir) {
    let textArray = [];
    if (typeof val === 'object' && val !== null && val.question && val.question.questionText) {
        textArray = Array.isArray(val.question.questionText) ? val.question.questionText : [val.question.questionText];
    } else {
        textArray = [String(val)];
    }

    let fullText = textArray.join('\n').replace(/\\n/g, '\n');

    const allTextData = typeof val === 'object' ? JSON.stringify(val) : fullText;
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const matches = [...new Set(allTextData.match(uuidRegex) || [])];

    let appendedImages = "";

    for (const uuid of matches) {
        const localPath = path.join(imgDir, `${uuid}.png`);
        let isDownloaded = await fileExists(localPath);
        
        if (!isDownloaded) {
            isDownloaded = await downloadImage(`https://cdn.sparx-learning.com/${uuid}`, localPath);
        }
        
        // Use forward slashes for LaTeX paths
        const imgCmd = isDownloaded 
            ? `\n\\vspace{0.5em}\\begin{center}\\includegraphics[max width=0.7\\textwidth]{images/${uuid}.png}\\end{center}\\vspace{0.5em}\n`
            : `\n\\vspace{1em}\\begin{center}\\textbf{[Image Missing/Failed Download: ${uuid}]}\\end{center}\\vspace{1em}\n`;
            
        if (fullText.includes(uuid)) {
            fullText = fullText.split(uuid).join(imgCmd);
        } else {
            appendedImages += imgCmd;
        }
    }

    fullText += appendedImages;

    return fullText.split('\n').map(line => {
        let trimmed = line.trim();
        if (!trimmed) return "\\vspace{1em}"; 
        if (trimmed.includes('includegraphics') || trimmed.includes('\\textbf{[Image')) return trimmed;
        return latexSafe(trimmed) + " \\par\\vspace{0.4em}"; 
    }).join('\n');
}

/** 
 * MAIN CONVERTER
 */
async function convertToPDF(obj, packageID) {
    const packageDir = path.join(__dirname, "pdfs", packageID);
    const imgDir = path.join(packageDir, "images");
    let pdfBuffer = null;

    try {
        await fs.mkdir(imgDir, { recursive: true });

        const items = [];
        for (const [key, val] of Object.entries(obj)) {
            const isObj = typeof val === "object" && val !== null;
            const rawAns = isObj ? (val.answer || "") : String(val);
            
            const questionContent = await processQuestion(val, imgDir);

            items.push({
                id: key,
                answer: latexSafe(rawAns),
                question: questionContent
            });
        }

        // --- PDF LAYOUT ---
        // Removed \fbox for the answer because if the answer contains a newline or is long, \fbox causes a fatal compilation error. 
        // A tcolorbox is line-break safe and auto-wraps text.
        const contentBlocks = items.map(item => String.raw`
            \noindent \textbf{\Large Bookwork code: ${item.id}}
            \vspace{1em}
            
            \begin{tcolorbox}[colback=white, colframe=gray!30, arc=6pt, boxrule=1pt, left=15pt, right=15pt, top=15pt, bottom=15pt]
                \large
                ${item.question}
            \end{tcolorbox}
            
            \vspace{1.5em}
            \noindent \textbf{\large Answer:}
            \vspace{0.5em}
            
            \begin{tcolorbox}[colback=white, colframe=black, boxrule=1pt, arc=3pt, left=10pt, right=10pt, top=8pt, bottom=8pt]
                \Large ${item.answer}
            \end{tcolorbox}
        `);
        
        const content = contentBlocks.join("\n\\vspace{2.5em} \\hrule \\vspace{2.5em}\n");

        const safeTitleID = String(packageID).replace(/_/g, '\\_');
        
        const dateStr = new Date().toLocaleDateString('en-GB', { 
            day: 'numeric', month: 'long', year: 'numeric' 
        });

        // Removed inputenc and fontenc. XeLaTeX natively uses UTF-8 and fontspec.
        const latexTemplate = String.raw`
            \documentclass[12pt]{article}
            \usepackage{fontspec}
            \usepackage{amsmath, amssymb, geometry, graphicx, xcolor, tcolorbox}
            \usepackage[export]{adjustbox}
            
            \renewcommand{\familydefault}{\sfdefault}
            \geometry{margin=0.8in, top=0.8in, bottom=0.8in}
            \setlength{\parindent}{0pt}
            \raggedbottom 
            
            \begin{document}
            
            \begin{center}
                {\LARGE \textbf{Bookwork for ${safeTitleID}}} \\ \vspace{0.8em}
                {\large \textcolor{gray!70!black}{${dateStr}}}
            \end{center}
            \vspace{0.5em}
            \hrule height 1pt
            \vspace{2.5em}
            
            ${content}
            \end{document}`;

        const texFile = path.join(packageDir, `${packageID}.tex`);
        await fs.writeFile(texFile, latexTemplate);

        try {
            await runXeLaTeX(`${packageID}.tex`, packageDir);
        } catch (e) {
            console.error(`LaTeX Compilation Error on ${packageID}:`, e.message);
        }

        const pdfPath = path.join(packageDir, `${packageID}.pdf`);
        if (await fileExists(pdfPath)) {
            pdfBuffer = await fs.readFile(pdfPath);
        }

    } catch (err) {
        console.error("PDF Gen Error:", err);
    } finally {
        try {
            await fs.rm(packageDir, { recursive: true, force: true });
        } catch (cleanupErr) {
            console.error("Cleanup Error:", cleanupErr);
        }
    }
    
    return pdfBuffer;
}

module.exports = { convertToPDF };