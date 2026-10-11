const getApiKeys = require('../../../../utils/getApiKeys.js');
const removeDuplicates = require('../../../../utils/removeDuplicates.js');
const useApiKeys = require('../../../../utils/useApiKeys.js');
const BaseParser = require('../../questionParser.js');

class SparxParser extends BaseParser {

    constructor(apiKeys) {
        super(apiKeys);
    }

    extractText(obj, results = []) {
        if (typeof obj === "object" && obj !== null) {
            if ("text" in obj && typeof obj.text === "string") {
                results.push(obj.text);
            }
            if (obj.element === 'text-field') {
                results.push(`> [INPUT HERE REF:${obj.ref}]`);
            }

            for (const key in obj) {
                this.extractText(obj[key], results);
            }
        } else if (Array.isArray(obj)) {
            obj.forEach(item => this.extractText(item, results));
        }
        return results;
    }

    // Extract choice groups
    extractChoiceGroups(input, layoutContent) {
        if (!input.choice_groups) return [];
        const groups = [];
        for (const key in input.choice_groups) {
            const g = input.choice_groups[key];
            groups.push({
                id: key,
                minChoices: g.min_choices,
                maxChoices: g.max_choices,
                shuffle: g.shuffle,
                choiceRefs: g.choice_refs
            });
        }

        const allRefs = groups.map(group => group.choiceRefs);

        function extractRefPos(obj, results = []) {
            if (typeof obj === "object" && obj !== null) {
                // Check if obj has a 'ref' property
                if (obj.ref) {
                    for (const [index, refArray] of allRefs.entries()) {
                        // refArray might be an array, check if it includes obj.ref
                        if (Array.isArray(refArray) && refArray.includes(obj.ref)) {
                            results.push(index);
                            break;
                        }
                    }
                }

                // Recurse for all properties
                for (const key in obj) {
                    extractRefPos(obj[key], results);
                }
            }
            return results;
        }

        const results = extractRefPos(layoutContent);
        // Remove duplicates while keeping first occurrence
        let uniqueResults = [...new Set(results)];

        const groupedByOrder = uniqueResults.map(index => groups[index]);

        return groupedByOrder;
    }

    getTextRefs(elements) {
        let refs = [];

        function traverse(element) {
            if (!element) return;

            // If it's an array, traverse each item
            if (Array.isArray(element)) {
                element.forEach(traverse);
                return;
            }

            // Check for answer-part with text-field
            if (element.type && element.type.includes("answer-part")) {
                if (element.content) {
                    element.content.forEach(c => {
                        if (c.element === "text-field" && c.ref) {
                            refs.push({ ref: c.ref, text_area: c.text_area ?? false });
                        }
                    });
                }
            }

            // Recurse into nested content
            if (element.content) {
                traverse(element.content);
            }
        }

        traverse(elements);
        return refs;
    }

    parseQuestion(json) {
        const layoutContent = json.layout.content;

        const questionText = this.extractText(layoutContent);
        const answerParts = this.extractAnswerParts(layoutContent);
        const images = this.extractImages(layoutContent);

        const slotCards = this.extractSlotCards(json.input);
        const choices = this.extractChoices(json.input);
        const choiceGroups = this.extractChoiceGroups(json.input, layoutContent);
        const numberFields = this.extractNumberFieldsWithLabels(json.layout.content, json.input.number_fields);
        const textFields = this.getTextRefs(layoutContent);

        return {
            questionText,
            answerParts,
            images,
            slotCards,
            choices,
            choiceGroups,
            numberFields,
            textFields
        };
    }

    getQuestionObject(aiAnswered, activityName, token) {

        const answerObject = {
            "name": activityName,
            "action": {
                "oneofKind": "answer",
                "answer": {
                    "components": aiAnswered,
                    "autoProgressStep": false
                }
            },
            "token": token
        };

        // console.log(answerObject.action.question.answer.components);
        return answerObject;
    }

    async parse(data, model, activityName, token, supportMaterial, incorrect_answers) {
        const parsedData = this.parseQuestion(data);

        const { geminiAnswer } = require('../../../../gemini/sparx_maths/main');
        const apikeys = removeDuplicates([...this.apiKeys, ...(await getApiKeys())]);
        const aiAnswered = await useApiKeys(apikeys, geminiAnswer.answerQuestion, [parsedData, model, incorrect_answers, "science", supportMaterial]);

        if (typeof aiAnswered === 'number') return aiAnswered;
        const answerObject = this.getQuestionObject(aiAnswered, activityName, token);

        return answerObject;
    }
}

module.exports = SparxParser;