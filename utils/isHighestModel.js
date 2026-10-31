const aiModels = require('../aiModelsRanking.json');

function isHigherModel(modelTest, lastModelTried) {
    const normalize = (m) => m.startsWith('gemini-') ? m : `gemini-${m}`;
    
    const testIndex = aiModels.indexOf(normalize(modelTest));
    const lastIndex = aiModels.indexOf(normalize(lastModelTried));

    // A model that is not in the ranking file must never block an upgrade.
    // Previously the undefined variable made every call throw, and the
    // duplicated index check hid it. Treat an unknown model as the weakest
    // option so a better-known model can still be tried.
    if (testIndex === -1) {
        return lastIndex > -1;
    }
    if (lastIndex === -1) {
        return false;
    }
    return lastIndex < testIndex;
}

module.exports = isHigherModel;