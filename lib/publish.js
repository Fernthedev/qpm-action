"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishRun = publishRun;
const utils_1 = require("./utils");
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const qpmf_1 = require("./qpmf");
const const_1 = require("./const");
function doPublish(octokit, release, debug, qmod, version, tag) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        core.info('Publishing');
        const qpmSharedPath = 'qpm.shared.json';
        //path.join(
        //  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        // process.env.GITHUB_WORKSPACE!,
        // 'qpm.shared.json'
        // )
        const qpmSharedFile = yield (0, qpmf_1.readQPM)(qpmSharedPath);
        if (version) {
            core.info(`Overwriting version with provided ${version}`);
            qpmSharedFile.config.info.version = version;
        }
        version !== null && version !== void 0 ? version : (version = qpmSharedFile.config.info.version);
        core.info(`Using version ${version} for publishing`);
        const branch = `version/v${version.replace(/\./g, '_')}`;
        qpmSharedFile.config.info.additionalData.branchName = branch;
        const additionalData = qpmSharedFile.config.info.additionalData;
        const download = (0, utils_1.getReleaseDownloadLink)(github.context.repo.owner, github.context.repo.repo, tag !== null && tag !== void 0 ? tag : version);
        const fileId = qpmSharedFile.config.info.id;
        const fixedFileVersion = version.replace(/\./g, '_');
        if (release) {
            const versionedName = `lib${fileId}_${fixedFileVersion}.so`;
            const name = (_a = additionalData.overrideSoName) !== null && _a !== void 0 ? _a : versionedName;
            qpmSharedFile.config.info.additionalData.soLink = `${download}/${name}`;
        }
        if (debug) {
            const nameOverride = additionalData.overrideSoName && `debug_${additionalData.overrideSoName}`;
            const debugVersionedName = `debug_lib${fileId}_${fixedFileVersion}.so`;
            const name = (_c = (_b = additionalData.overrideDebugSoName) !== null && _b !== void 0 ? _b : nameOverride) !== null && _c !== void 0 ? _c : debugVersionedName;
            qpmSharedFile.config.info.additionalData.debugSoLink = `${download}/${name}`;
        }
        if (qmod) {
            qpmSharedFile.config.info.additionalData.modLink = `${download}/${qmod}`;
        }
        yield (0, qpmf_1.writeQPM)(qpmSharedPath, qpmSharedFile);
        const git = octokit.rest.git;
        yield core.group('Publish', () => __awaiter(this, void 0, void 0, function* () {
            // create branch
            // reference https://github.com/peterjgrainger/action-create-branch/blob/c2800a3a9edbba2218da6861fa46496cf8f3195a/src/create-branch.ts#L3
            const branchHead = `heads/${branch}`;
            const branchRef = `refs/${branchHead}`;
            core.info('Getting data');
            // get current repo data
            const lastCommitSha = github.context.sha;
            const lastCommit = yield git.getCommit(Object.assign(Object.assign({}, github.context.repo), { commit_sha: lastCommitSha }));
            try {
                core.info('creating new branch');
                yield git.createRef(Object.assign(Object.assign({}, github.context.repo), { ref: branchRef, sha: lastCommitSha, key: branchRef }));
            }
            catch (e) {
                core.warning(`Creating new branch ${branch} failed due to ${e}`);
            }
            core.info('Creating commit');
            // create commit
            const newTree = yield git.createTree(Object.assign(Object.assign({}, github.context.repo), { tree: [
                    {
                        content: JSON.stringify(qpmSharedFile),
                        path: qpmSharedPath,
                        mode: '100644'
                    }
                ], base_tree: lastCommit.data.tree.sha }));
            const commit = yield git.createCommit(Object.assign(Object.assign({}, github.context.repo), { parents: [lastCommitSha], message: 'Update version and post restore', tree: newTree.data.sha }));
            // update branch
            core.info(`Updating branch ${branchRef} ${commit.data.sha}`);
            yield git.updateRef(Object.assign(Object.assign({}, github.context.repo), { ref: branchHead, sha: commit.data.sha, force: true }));
        }));
        // do github stuff
    });
}
function publishRun(params) {
    return __awaiter(this, void 0, void 0, function* () {
        const { token, qpmDebugBin, qpmQmod, qpmReleaseBin, version, publishToken, tag } = params;
        const octokit = github.getOctokit(token);
        yield doPublish(octokit, qpmReleaseBin, qpmDebugBin, qpmQmod, version, tag);
        yield (0, utils_1.githubExecAsync)(`qpm ${const_1.QPM_COMMAND_PUBLISH} "${publishToken !== null && publishToken !== void 0 ? publishToken : ''}"`);
    });
}
