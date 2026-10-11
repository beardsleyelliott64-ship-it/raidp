require('dotenv').config();
const { Type } = require("@google/genai");
const Image_Requesticator = require('./requesticator');
const { GoogleGenAI } = require("@google/genai");

function isUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

class geminiAnswers {
    constructor() {
        this.requesticator = new Image_Requesticator();
        this.answerQuestion = this.answerQuestion.bind(this);
    }

    async answerQuestion(apikey, questionObj, model, incorrect_answers, sparx="maths", supportMaterial) {

        const ai = new GoogleGenAI({ apiKey: apikey });
        try {

        const contents = [];

        // If image exists, include it
        if (questionObj['images'].length) {
            const imageUrl = `https://cdn.sparx-learning.com/${questionObj['images'][0].url}`;
            const responseImage = await this.requesticator.sendRequest(imageUrl);
            const base64ImageData = Buffer.from(responseImage.data).toString('base64');

            contents.push({
                inlineData: {
                mimeType: 'image/jpeg',
                data: base64ImageData,
                altText: 'Question Image'
                },
            });
        }

        // Always include question text
        let totalText = "";
        let systemInstruction = '';
        for (const text of questionObj['questionText']) {
            totalText += `${text}\n`;
        }
        if (supportMaterial) {
            totalText += `Support Material: ${supportMaterial}`;
            systemInstruction = 'PLEASE USE THE SUPPORT MATERIAL;';
        }

        // add incorrect answers to the question
        if (incorrect_answers) {
            totalText += `NOTE: Another AI Model tried to answer the question and these were its INCORRECT answers (THESE ARE INCORRECT 100%, DO NOT ARGUE OR PUT THESE AGAIN).`;
            for (const answer of incorrect_answers) {
                totalText += `\n - ${answer}`;
            }
        }

        contents.push({ text: totalText });

        const properties = {};
        const findCardRef = [];

        const cardToRefs = {};
        for (const choiceGroup of questionObj.choiceGroups) {
            cardToRefs[choiceGroup.id] = [];
            for (const ref of choiceGroup.choiceRefs) {
                cardToRefs[choiceGroup.id].push(questionObj.choices[ref]);
            }
        }

        let index = 0;

        for (const [key, value] of Object.entries(cardToRefs)) {
            for (const valueID of Object.values(value)) {
                if (isUUID(valueID)) {
                    systemInstruction = "Determine the positions of the images for the array based on their alt text descriptions. Do not rely on the order of the images in the array that is provided.";
                    
                    const imageUrl = `https://cdn.sparx-learning.com/${valueID}`;
                    const responseImage = await this.requesticator.sendRequest(imageUrl);
                    const base64ImageData = Buffer.from(responseImage.data).toString('base64');

                    contents.push({
                        inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64ImageData,
                        altText: `This is the id of the image: ${valueID}`
                        },
                    });
                
                }
            }
            properties[key] = {type: Type.ARRAY, items: { type: Type.STRING, enum: value }, minItems: questionObj.choiceGroups[index].minChoices, maxItems: questionObj.choiceGroups[index].maxChoices};
            index++;
        }
        // properties['choices'] = {type: Type.ARRAY, items: { type: Type.STRING, enum: Object.values(questionObj.choices) }, minItems: questionObj.choiceGroups[0].minChoices, maxItems: questionObj.choiceGroups[0].maxChoices};

        for (const [index, [key, card]] of Object.entries(questionObj.slotCards).entries()) {
            const cardValues = [];
            findCardRef.push({});
            for (const item of card) {
                const valueID = item.value;
                if (isUUID(valueID)) {
                    systemInstruction = "Determine the positions of the images for the array based on their alt text descriptions. Do not rely on the order of the images in the array that is provided.";
                    const imageUrl = `https://cdn.sparx-learning.com/${valueID}`;
                    const responseImage = await this.requesticator.sendRequest(imageUrl);
                    const base64ImageData = Buffer.from(responseImage.data).toString('base64');

                    contents.push({
                        inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64ImageData,
                        altText: `This is the id of the image: ${valueID}`
                        },
                    });
                }
                cardValues.push(item.value);
                findCardRef[index][item.value] = item.ref;
            }
            // console.log(cardValues);
            if (cardValues.includes('have')) {
                properties[key] = {type: Type.STRING, description: 'Always choose "have" over "have not"', enum: cardValues};
            } else {
                properties[key] = {type: Type.STRING, enum: cardValues};
            }
        }

        // console.log("Properties before");
        // console.log(properties);
        questionObj.textFields.forEach(field => {
            const description = field.text_area ? 'Use keywords in your answer and limit it to a paragraph' : 'Your answer should be no longer than a word or a few words';
            properties[field.ref] = {
                type: Type.STRING,
                description: description
            };
        });

        questionObj.numberFields.forEach(field => {
            properties[field.ref] = {
                type: Type.NUMBER,
                description: field.label
            };
        });

        if (sparx === 'maths') {
            properties['BearingAsAnswer'] = {
                type: Type.BOOLEAN,
                description: 'If the question wants you to give the answer as a bearing then set this as true.'
            };
        }

        if (sparx === 'science') {
            systemInstruction += ' DO NOT USE LATEX FOR YOUR ANSWER';
        }

        let response = await ai.models.generateContent({
            model: `gemini-${model}`,
            contents: contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: properties,
                    required: Object.keys(properties),
                    propertyOrdering: Object.keys(properties),
                },
                systemInstruction: systemInstruction
            },
        });

        // Parse output
        const answerObj = JSON.parse(response.candidates[0].content.parts[0].text);

        // Convert all values to strings (if needed)
        // console.log(findCardRef);
        for (const [index, [ref, value]] of Object.entries(answerObj).entries()) {
            if (ref.includes('choice_group')) {
                // Map selected choice TEXT back to Sparx choice REF.
                // Submit ref as key and value — Sparx grades MCQ by ref, not latex display text.
                const norm = (s) => String(s || '').replace(/\\times/g, '×').replace(/\\/g, '').replace(/\s+/g, ' ').trim();
                for (const valueID of (Array.isArray(value) ? value : [value])) {
                    let key = Object.keys(questionObj.choices).find(k => questionObj.choices[k] === valueID);
                    if (!key) {
                        const nTarget = norm(valueID);
                        key = Object.keys(questionObj.choices).find(k => norm(questionObj.choices[k]) === nTarget);
                    }
                    if (!key) {
                        const nTarget = norm(valueID);
                        key = Object.keys(questionObj.choices).find(k => {
                            const n = norm(questionObj.choices[k]);
                            return n.includes(nTarget) || nTarget.includes(n);
                        });
                    }
                    if (key) {
                        answerObj[key] = key;
                        delete answerObj[ref];
                    }
                }
            } else if (findCardRef[index] && value in findCardRef[index]) {
                answerObj[ref] = String(findCardRef[index][value]);
            } else {
                for (const numberField of questionObj.numberFields) {
                    if (numberField.ref === ref) {
                        if (numberField?.properties?.sign === 'positive') {
                            answerObj[ref] = Math.abs(answerObj[ref]);
                        }
                        if (answerObj.BearingAsAnswer === true) {
                            answerObj[ref] = String(answerObj[ref]).padStart(3, '0');
                        }
                    }
                }

                if (sparx === 'science') {
                    const objectRef = questionObj.choiceGroups.find(key => key.id === ref);
                    if (!objectRef) {
                        answerObj[ref] = String(answerObj[ref]);
                    } else {
                        const answerChoicesRefs = {};
                        for (const choiceRef of objectRef.choiceRefs) {
                            answerChoicesRefs[questionObj.choices[choiceRef]] = choiceRef;
                        }
                        for (const i in value) {
                            answerObj[answerChoicesRefs[value[i]]] = value[i];
                        }
                        delete answerObj[ref];
                    }
                } else {
                    answerObj[ref] = String(answerObj[ref]);
                }
            }
        }

        delete answerObj.BearingAsAnswer;

        return answerObj;

        } catch(err) {
            // 404 = model retired / not available for this key — caller should try next model
            const handlableErrorCodes = [503, 429, 400, 404];
            let parsed = err;
            let code = err?.status ?? err?.code;

            if (err instanceof Error) {
                try {
                    parsed = JSON.parse(err.message);
                    code = parsed?.error?.code ?? code;
                } catch {
                    const m = String(err.message || '');
                    const embedded = m.match(/"code"\s*:\s*(\d+)/);
                    if (embedded) code = Number(embedded[1]);
                    if (/no longer available|NOT_FOUND|is not found/i.test(m)) code = 404;
                }
            } else if (typeof err === 'string') {
                try {
                    parsed = JSON.parse(err);
                    code = parsed?.error?.code ?? code;
                } catch {
                    parsed = { error: { message: err } };
                }
            }

            code = Number(code ?? parsed?.error?.code);
            if (handlableErrorCodes.includes(code)) {
                return code;
            }
            throw err;
        }

    }
}

const geminiAnswer = new geminiAnswers();
module.exports = { geminiAnswer, geminiAnswers };