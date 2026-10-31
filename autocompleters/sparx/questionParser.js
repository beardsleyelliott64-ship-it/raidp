class SparxParser {

    constructor(apiKeys) {
        this.apiKeys = apiKeys;
    }

    extractQuestionText(content) {
        if (!content) return '';
        let text = '';
        if (Array.isArray(content)) {
            for (const item of content) text += this.extractQuestionText(item);
            return text;
        }
        if (content.element === 'text') return content.text + ' ';
        if (content.type?.includes('question-text') || content.content) {
            text += this.extractQuestionText(content.content);
        }
        return text;
    }

    // Recursive function to extract answer parts
    extractAnswerParts(content) {
        if (!content) return [];
        let parts = [];
        if (Array.isArray(content)) {
            for (const item of content) parts = parts.concat(this.extractAnswerParts(item));
            return parts;
        }
        if (content.type?.includes('answer-part')) {
            const partText = this.extractQuestionText(content.content).trim();
            parts.push({ id: content.id, text: partText });
        } else if (content.content) {
            parts = parts.concat(this.extractAnswerParts(content.content));
        }
        return parts;
    }

    // Recursive function to extract images
    extractImages(content) {
        if (!content) return [];
        let images = [];
        if (Array.isArray(content)) {
            for (const item of content) images = images.concat(this.extractImages(item));
            return images;
        }
        if (content?.figure?.image) images.push({ url: content.figure.image });
        else if (content.content) images = images.concat(this.extractImages(content.content));
        return images;
    }

    // Extract slot-based answer options
    extractSlotCards(input) {
        const slotMapping = {};
        if (!input.slot_groups || !input.cards) return slotMapping;

        for (const groupKey in input.slot_groups) {
            const group = input.slot_groups[groupKey];
            const slotRefs = group.slot_refs;

            slotRefs.forEach(slotRef => {
                const cardRefs = input.card_groups[groupKey]?.card_refs || [];
                slotMapping[slotRef] = cardRefs.map(ref => ({
                    ref,
                    value: input.cards[ref].content.map(c => c.text).join(' ') || input.cards[ref].content.map(c => c.src).join(' '),
                }));
            });
        }
        return slotMapping;
    }

    // Extract multiple-choice options
    extractChoices(input) {
        if (!input.choices) return {};
        const choices = {};
        for (const ref in input.choices) {
            choices[ref] = input.choices[ref].content.map(c => c.text).join(' ');
            if (!choices[ref]) {
                choices[ref] = input.choices[ref].content.map(c => c.src).join(' ');
            }
        }
        return choices;
    }

    // Recursive function to extract number fields from layout
    // Extract number fields with their preceding text
    extractNumberFieldsWithLabels(content, number_fields) {
        if (!content) return [];
        let fields = [];

        if (Array.isArray(content)) {
            for (let i = 0; i < content.length; i++) {
                const item = content[i];

                // If it's a number-field, capture the nearest text before it
                if (item.element === 'number-field' && item.ref) {
                    let label = null;

                    // Look back for the nearest text element
                    if (i > 0 && content[i - 1].element === 'text') {
                        label = content[i - 1].text;
                    }

                    fields.push({ ref: item.ref, label, properties: number_fields[item.ref] });
                }

                // Recurse if this item has nested content
                if (item.content) {
                    fields = fields.concat(this.extractNumberFieldsWithLabels(item.content, number_fields));
                }
            }
            return fields;
        }

        // Recurse single object
        if (content.content) {
            fields = fields.concat(this.extractNumberFieldsWithLabels(content.content, number_fields));
        }

        return fields;
    }
}

module.exports = SparxParser;