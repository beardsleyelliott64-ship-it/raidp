const getApiKeys = require('../../../../utils/getApiKeys.js');
const removeDuplicates = require('../../../../utils/removeDuplicates.js');
const useApiKeys = require('../../../../utils/useApiKeys.js');
const BaseParser = require('../../questionParser.js');

class SparxQuestionParser extends BaseParser {
    
    constructor(interaction, apiKeys) {
        super(apiKeys);
        this.userId = interaction.user.id;
    }

    extractText(obj, results = []) {
        if (typeof obj === "object" && obj !== null) {
            if ("text" in obj && typeof obj.text === "string") {
                results.push(obj.text);
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
    extractChoiceGroups(input) {
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
        return groups;
    }

    // Extract text fields
    extractTextFields(input) {
        return input.text_fields ? Object.keys(input.text_fields) : [];
    }

    // Main parser function
    parseQuestion(json) {
        const layoutContent = json.layout.content;

        const questionText = this.extractText(layoutContent[0]);
        const answerParts = this.extractAnswerParts(layoutContent);
        const images = this.extractImages(layoutContent);

        const slotCards = this.extractSlotCards(json.input);
        const choices = this.extractChoices(json.input);
        const choiceGroups = this.extractChoiceGroups(json.input);
        const numberFields = this.extractNumberFieldsWithLabels(json.layout.content, json.input.number_fields);
        const textFields = this.extractTextFields(json.input);

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

    getQuestionObject(aiAnswered, activityIndex, questionIndex) {
        const UserSessions = require('./userSessions.js');
        const userSession = UserSessions.get(this.userId);

        const components = [];
        for (const [key, value] of Object.entries(aiAnswered)) {
            components.push({
                'key': key,
                'value': value
            });
        }

        const answerObject = {
            "activityIndex": activityIndex,
            "action": {
                "oneofKind": "question",
                "question": {
                    "questionIndex": questionIndex,
                    "actionType": 1,
                    "answer": {
                        "components": components,
                        "hash": ""
                    }
                }
            },
            "timestamp": userSession.sparxMathsExecuter.getTimestamp(true)
        };

        // console.log(answerObject.action.question.answer.components);
        return answerObject;
    }

    async parseBookworkData(data, bookmarks) {
        const parsedBookwork = [];
        if (!data || !Array.isArray(data.options) || data.options.length === 0) {
            return null;
        }
        for (const option of data.options) {
            const comp = option.wacedAnswer?.components;
            if (comp && option.filledAnswerTemplate) {
                parsedBookwork.push({ filledAnswerTemplate: option.filledAnswerTemplate, components: comp });
            }
        }

        const bookworkCode = data.bookworkCode;
        for (const bookmark of parsedBookwork) {

            const bookmarkParsed = bookmark.filledAnswerTemplate
                .replace(/<[^>]*>/g, ' ') // replace tags with spaces
                .replace(/\s+/g, ' ')     // normalize multiple spaces
                .trim();

            if (bookmarks?.[bookworkCode] && bookmarkParsed === bookmarks[bookworkCode]) {
                return { filledAnswerTemplate: bookmark.filledAnswerTemplate, components: bookmark.components };
            }
        }
        
        /*
        if (parsedBookwork.length > 0) {
            const randomIndex = Math.floor(Math.random() * parsedBookwork.length);
            const randomBookmark = parsedBookwork[randomIndex];
            console.log(`Selected random answer: ${randomBookmark.filledAnswerTemplate}`);
            return { answerMarkup: randomBookmark.filledAnswerTemplate, components: { key: randomBookmark.key, value: randomBookmark.value}};
        }
        */
        
        return null;
    }

    parseBookwork(activityIndex, parsedBookworkAnswer, executer) {
        if (!Array.isArray(parsedBookworkAnswer.components)) {
            parsedBookworkAnswer.components = [parsedBookworkAnswer.components];
        }
        const answer = {
            "activityIndex": activityIndex,
            "action": {
                "oneofKind": "wac",
                "wac": {
                    "actionType": 1,
                    "extraData": {
                        "answerMarkup": parsedBookworkAnswer.filledAnswerTemplate
                    },
                    "answer": {
                        "components": parsedBookworkAnswer.components,
                        "hash": ""
                    }
                }
            },
            "timestamp": executer.getTimestamp()
        };

        return answer;

        // console.log(parsedBookwork);
    }

    async parse(data, activityIndex, questionIndex, model, incorrect_answers) {
        const parsedData = this.parseQuestion(data);

        const { geminiAnswer } = require('../../../../gemini/sparx_maths/main');
        const apikeys = removeDuplicates([...this.apiKeys, ...(await getApiKeys())]);
        const aiAnswered = await useApiKeys(apikeys, geminiAnswer.answerQuestion, [parsedData, model, incorrect_answers]);
        if (typeof aiAnswered === 'number') return aiAnswered;
        return this.getQuestionObject(aiAnswered, activityIndex, questionIndex);
    }
}

module.exports = SparxQuestionParser;