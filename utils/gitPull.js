const { spawn } = require('child_process');

async function runGitPull() {
	return new Promise((resolve, reject) => {
		const proc = spawn('git', ['pull', 'origin', 'main']);

		let output = '';
		let error = '';

		proc.stdout.on('data', d => output += d.toString());
		proc.stderr.on('data', d => error += d.toString());

		proc.on('error', reject);

		proc.on('close', code => {
			if (code === 0) {
				// 🔥 refresh version cache
				delete require.cache[require.resolve('./version')];
				require('./version');

				resolve(output.trim());
			} else {
				reject(new Error(error || `git exited with ${code}`));
			}
		});
	});
}

module.exports = runGitPull;