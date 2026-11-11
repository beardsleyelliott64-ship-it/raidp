async function login({
  username,
  password
} = {}) {
    const loginResponse = await fetch('https://api.languagenut.com/loginController/attemptLogin', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            username: username,
            pass: password
        })
    });

    const data = await loginResponse.json();
    return { authToken: data.newToken};
}

module.exports = login;