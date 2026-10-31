const login = require('./login');

class Requesticator {
    constructor(token, loginDetails) {
        this.token = token;
        this.loginDetails = loginDetails;
    }

    loadFromObject(data) {
        Object.assign(this, data);
    }

    async sendRequest(url, data) {
        const url_data = new URLSearchParams(data).toString();

        const response = await fetch(
            `https://api.languagenut.com/${url}?${url_data}`,
        );

        const text = await response.text();   // ← read as text, not json
        const json = JSON.parse(text);       // ← detach from stream

        if (json?.msg === 'doubleLogin') {
            const dataLogin = await login({
                username: this.loginDetails.username,
                password: this.loginDetails.password
            });

            this.token = dataLogin.newToken;
            data.token = dataLogin.newToken;

            return this.sendRequest(url, data); // no await needed
        }

        return json;
    }

    async getHomeworks() {
        const homeworks = await this.sendRequest(
            "assignmentController/getViewableAll",
            {
                token: this.token,
            },
        );
        // this.originalHomeworks = homeworks.homework || [];
        return homeworks;
    }

    async getDisplayTranslation() {
        const display_translations = await this.sendRequest(
            "publicTranslationController/getTranslations",
            {},
        );
        return display_translations.translations;
    }

    async getModuleTranslations() {
        const module_translations = await this.sendRequest(
            "translationController/getUserModuleTranslations",
            {
                token: this.token,
            },
        );
        return module_translations.translations;
    }

    async getUserInfo() {
        const loginResponse = await fetch('https://api.languagenut.com/userDataController/getUserData', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                token: this.token
            })
        });

        const data = await loginResponse.json();
        return data;
    }

    async getAccountId() {
        const userInfo = await this.getUserInfo();
        return userInfo.userUid;
    }

    async getData() {
        switch (this.mode) {
            case 'sentence':
                return await this.get_sentences();
            case 'verbs':
                return await this.get_verbs();
            case 'phonics':
                return await this.get_phonics();
            case 'exam':
                return await this.get_exam();
            default:
                return await this.get_vocabs();
        }
    }

    async get_sentences() {
        const vocabs = await this.sendRequest(
            "sentenceTranslationController/getSentenceTranslations",
            {
                catalogUid: this.catalog_uid,
                toLanguage: this.to_language,
                fromLanguage: "en-US",
                languagenutTimeMarker: Date.now(),
                lastLanguagenutTimeMarker: Date.now(),
                token: this.token,
            },
        );
        return vocabs.sentenceTranslations;
    }

    async get_exam() {
        const vocabs = await this.sendRequest(
            "examTranslationController/getExamTranslationsCorrect",
            {
                gameUid: this.game_uid,
                examUid: this.catalog_uid,
                toLanguage: this.to_language,
                fromLanguage: "en-US",
                token: this.token,
            },
        );

        return vocabs.examTranslations;
    }

    async get_vocabs() {
        const vocabs = await this.sendRequest(
            "vocabTranslationController/getVocabTranslations",
            {
                "catalogUid[]": this.catalog_uid,
                toLanguage: this.to_language,
                fromLanguage: "en-US",
                token: this.token,
            },
        );

        return vocabs.vocabTranslations;
    }

    async get_phonics() {
        const vocabs = await this.sendRequest("phonicsController/getPhonicsData", {
            phonicCatalogUid: this.catalog_uid,
            toLanguage: this.to_language,
            fromLanguage: "en-US",
            token: this.token,
        });
        return vocabs.phonics;
    }

    async get_verbs() {
        const vocabs = await this.sendRequest(
            "verbTranslationController/getVerbTranslations",
            {
                verbUid: this.catalog_uid,
                toLanguage: this.to_language,
                fromLanguage: "en-US",
                token: this.token,
            },
        );
        return vocabs.verbTranslations;
    }


    async send_answers(correctVocabs, incorrectVocabs, timestampOffsets) {
        /*
        const isTeacherMarked = this.game_uid === "251" ||
            (this.task.gameResults && this.task.gameResults.percentage === null) ||
            this.task.teacherMarked === true;

        if (isTeacherMarked) {
            console.log(`\n⚠️ TEACHER-MARKED TASK DETECTED, SKIPPING`);
            return { status: 'skipped', reason: 'teacher-marked' };
        }
        */

        const totalVocabs = correctVocabs.concat(incorrectVocabs);

        const data = {
            moduleUid: this.catalog_uid,
            gameUid: this.game_uid,
            gameType: this.game_type,
            isTest: true,
            toietf: this.to_language,
            fromietf: "en-US",
            score: correctVocabs.length * 200,
            correctVocabs: correctVocabs.map((x) => x).join(","),
            incorrectVocabs: incorrectVocabs.map((x) => x).join(","),
            homeworkUid: this.homework_id,
            isSentence: this.mode === "sentence",
            isALevel: false,
            isVerb: this.mode === "verbs",
            verbUid: this.mode === "verbs" ? this.catalog_uid : "",
            phonicUid: this.mode === "phonics" ? this.catalog_uid : "",
            sentenceScreenUid: this.mode === "sentence" ? 100 : "",
            sentenceCatalogUid: this.mode === "sentence" ? this.catalog_uid : "",
            grammarCatalogUid: this.catalog_uid,
            isGrammar: false,
            isExam: this.mode === "exam",
            correctStudentAns: "",
            incorrectStudentAns: "",
            vocabNumber: totalVocabs.length,
            rel_module_uid: this.rel_module_uid,
            dontStoreStats: true,
            product: "secondary",
            token: this.token,
        };

        // console.log('Languagenut data', data);

        const timeNow = Date.now();

        data.awrtfuoivg = String(timestampOffsets * 1000);

        data.languagenutTimeMarker = timeNow;
        data.lastLanguagenutTimeMarker = timeNow;

        try {

            const response = await this.sendRequest("gameDataController/addGameScore", data);

            if (response && (response.SUCCESS === true || response.changedPercentage === 100)) {
                return { status: 'success', response };
            } else {
                return { status: 'error', response };
            }
        } catch (error) {
            console.error(`Error sending answers:`, error);
            return { status: 'error', error: error.message };
        }
    }

    getTaskType() {
        if (this.task.gameLink.includes("sentenceCatalog")) this.mode = "sentence";
        if (this.task.gameLink.includes("verbUid")) this.mode = "verbs";
        if (this.task.gameLink.includes("phonicCatalogUid")) this.mode = "phonics";
        if (this.task.gameLink.includes("examUid")) this.mode = "exam";
        this.mode = "vocabs";
    }


}

module.exports = Requesticator;