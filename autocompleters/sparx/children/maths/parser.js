const getApiKeys = require('../../../../utils/getApiKeys.js');
const removeDuplicates = require('../../../../utils/removeDuplicates.js');
const useApiKeys = require('../../../../utils/useApiKeys.js');
const BaseParser = require('../../questionParser.js');

class SparxQuestionParser extends BaseParser {
    
    constructor(interaction, apiKeys) {
        // DB may store null, {}, or an array — always normalise to a string[]
        let keys = [];
        if (Array.isArray(apiKeys)) {
            keys = apiKeys.filter(Boolean).map(String);
        } else if (apiKeys && typeof apiKeys === 'object') {
            keys = Object.keys(apiKeys).filter(k => apiKeys[k]).map(String);
            if (!keys.length) {
                keys = Object.values(apiKeys)
                    .filter(v => typeof v === 'string' && v.startsWith('AIza'))
                    .map(String);
            }
        }
        super(keys);
        this.userId = interaction?.user?.id;
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
        const ranking = require('../../../../aiModelsRanking.json');
        const local = Array.isArray(this.apiKeys) ? this.apiKeys : [];
        const apikeys = removeDuplicates([...local, ...(await getApiKeys(local))]);

        // Build fallback chain: requested model first, then ranking (newest → older)
        const strip = (m) => String(m || '').replace(/^gemini-/, '');
        const primary = strip(model) || '3.8-flash';
        const fallbacks = ranking
            .map(strip)
            .filter((m) => m && m !== primary);
        // Prefer newer flash variants after primary
        const preferred = ['3.8-flash', '3.8-flash-lite', '3.5-flash', '3.5-flash-lite', '3.1-flash-lite-preview', '3-flash-preview', '2.0-flash'];
        const ordered = [primary, ...preferred.filter((m) => m !== primary), ...fallbacks]
            .filter((m, i, arr) => m && arr.indexOf(m) === i);

        let lastCode;
        for (const tryModel of ordered) {
            const aiAnswered = await useApiKeys(apikeys, geminiAnswer.answerQuestion, [parsedData, tryModel, incorrect_answers]);
            if (typeof aiAnswered !== 'number') {
                return this.getQuestionObject(aiAnswered, activityIndex, questionIndex);
            }
            lastCode = aiAnswered;
            // 404 = model gone → try next model; other codes (429/503) also fall through
            if (aiAnswered !== 404 && aiAnswered !== 503 && aiAnswered !== 429) {
                return aiAnswered;
            }
        }
        return lastCode;
    }
}

module.exports = SparxQuestionParser;