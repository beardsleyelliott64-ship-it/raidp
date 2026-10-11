const canonicalize = require('../../utils/canonicalize.js');

function parseQuestionForDB(rquestion, includeMarks=false) {
    // Helper to prevent JSON.parse(undefined) errors in canonicalize
    const question = JSON.parse(rquestion)[0];
    const safeCanonicalize = (data, fallback) => {
        if (data === undefined || data === null) return fallback;
        try {
            return canonicalize(data);
        } catch {
            console.warn("⚠️ Canonicalize failed, returning fallback.");
            return fallback;
        }
    };

    let elementStr = null;
    let typeArr = null;
    let contentArr = [];
    let inputObj = {};

    // FORMAT 1: Has "layout" and "input" (e.g., Multiple Choice)
    if (question && question.layout) {
        elementStr = question.layout.element;
        typeArr = question.layout.type;
        contentArr = question.layout.content;
        inputObj = question.input || {};
    } 
    // FORMAT 2: Direct Object (e.g., Number Field / Part-Group)
    else if (question && question.element) {
        elementStr = question.element;
        typeArr = question.type;
        contentArr = question.content;
        // inputObj remains {} because this format doesn't have an "input" dictionary
    }

    const returnObj = {
        element: elementStr || null,
        type: typeArr || null,
        content: safeCanonicalize(contentArr, []),
        cards: safeCanonicalize(inputObj.cards, {}),
        choices: safeCanonicalize(inputObj.choices, {}),
        slots: safeCanonicalize(inputObj.slots, {}),
        number_fields: safeCanonicalize(inputObj.number_fields, {}),
        text_fields: safeCanonicalize(inputObj.text_fields, {}),
        card_groups: safeCanonicalize(inputObj.card_groups, {}),
        slot_groups: safeCanonicalize(inputObj.slot_groups, {}),
        choice_groups: safeCanonicalize(inputObj.choice_groups, {})
    };

    if (includeMarks) {
        returnObj.marks = question.marks;
    }

    // Prepare Payload mapped to your table columns
    return returnObj;
}

module.exports = parseQuestionForDB;