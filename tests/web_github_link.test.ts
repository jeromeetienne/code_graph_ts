import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WebCommand } from '../src/commands/web_command.js';

describe('WebCommand.githubBaseUrl', () => {
	it('normalises the SCP-like form', () => {
		assert.equal(WebCommand.githubBaseUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo');
	});

	it('normalises the https form, with and without .git', () => {
		assert.equal(WebCommand.githubBaseUrl('https://github.com/owner/repo.git'), 'https://github.com/owner/repo');
		assert.equal(WebCommand.githubBaseUrl('https://github.com/owner/repo'), 'https://github.com/owner/repo');
	});

	it('normalises the ssh:// and git:// forms', () => {
		assert.equal(WebCommand.githubBaseUrl('ssh://git@github.com/owner/repo.git'), 'https://github.com/owner/repo');
		assert.equal(WebCommand.githubBaseUrl('git://github.com/owner/repo.git'), 'https://github.com/owner/repo');
	});

	it('tolerates a trailing slash and surrounding whitespace', () => {
		assert.equal(WebCommand.githubBaseUrl('  https://github.com/owner/repo/  '), 'https://github.com/owner/repo');
	});

	it('keeps the host for GitHub Enterprise remotes', () => {
		assert.equal(WebCommand.githubBaseUrl('git@github.example.com:owner/repo.git'), 'https://github.example.com/owner/repo');
	});

	it('returns undefined for non-GitHub hosts', () => {
		assert.equal(WebCommand.githubBaseUrl('git@gitlab.com:owner/repo.git'), undefined);
		assert.equal(WebCommand.githubBaseUrl('https://bitbucket.org/owner/repo.git'), undefined);
	});

	it('returns undefined for unparseable or incomplete remotes', () => {
		assert.equal(WebCommand.githubBaseUrl('not a url'), undefined);
		assert.equal(WebCommand.githubBaseUrl('https://github.com/owner'), undefined);
	});
});
