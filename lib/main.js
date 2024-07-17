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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const tc = __importStar(require("@actions/tool-cache"));
const cache = __importStar(require("@actions/cache"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const api_1 = require("./api");
const const_1 = require("./const");
const utils_1 = require("./utils");
const qpmf_1 = require("./qpmf");
const publish_1 = require("./publish");
const strip_ansi_1 = __importDefault(require("strip-ansi"));
function downloadQpm(octokit, token) {
    return __awaiter(this, void 0, void 0, function* () {
        const expectedArtifactName = (0, api_1.getQPM_RustExecutableName)();
        core.debug(`Looking for ${expectedArtifactName} in ${const_1.QPM_REPOSITORY_OWNER}/${const_1.QPM_REPOSITORY_NAME}`);
        const branch = yield octokit.rest.repos.getBranch({
            branch: const_1.QPM_REPOSITORY_BRANCH,
            owner: const_1.QPM_REPOSITORY_OWNER,
            repo: const_1.QPM_REPOSITORY_NAME
        });
        const qpmVersion = branch.data.commit.sha;
        let cachedPath = tc.find('qpm', qpmVersion);
        if (fs.existsSync(cachedPath)) {
            core.debug('Using existing qpm tool cached');
            core.addPath(cachedPath);
            return path.join(cachedPath, 'qpm');
        }
        // List artifacts for the QPM repository
        const workflowRunsResult = yield octokit.rest.actions.listWorkflowRunsForRepo({
            owner: const_1.QPM_REPOSITORY_OWNER,
            repo: const_1.QPM_REPOSITORY_NAME,
            status: 'success',
            exclude_pull_requests: true,
            branch: const_1.QPM_REPOSITORY_BRANCH
        });
        const workflowRuns = workflowRunsResult.data.workflow_runs.sort((a, b) => a.run_number - b.run_number);
        // get latest workflow
        const workflowId = workflowRuns[workflowRuns.length - 1];
        const listedArtifacts = yield octokit.rest.actions.listWorkflowRunArtifacts({
            owner: const_1.QPM_REPOSITORY_OWNER,
            repo: const_1.QPM_REPOSITORY_NAME,
            run_id: workflowId.run_number
        });
        const artifact = listedArtifacts.data.artifacts.find(e => {
            var _a;
            return e.name === expectedArtifactName &&
                ((_a = e.workflow_run) === null || _a === void 0 ? void 0 : _a.head_branch) === const_1.QPM_REPOSITORY_BRANCH;
        });
        if (!artifact) {
            core.error(`No artifact found for ${const_1.QPM_REPOSITORY_OWNER}/${const_1.QPM_REPOSITORY_NAME}@${const_1.QPM_REPOSITORY_BRANCH} `);
        }
        const url = artifact.archive_download_url;
        // const url = `https://nightly.link/${QPM_REPOSITORY_OWNER}/${QPM_REPOSITORY_NAME}/workflows/${QPM_REPOSITORY_WORKFLOW_NAME}/${QPM_REPOSITORY_BRANCH}/${expectedArtifactName}.zip`
        core.debug(`Downloading from ${url}`);
        const qpmTool = yield tc.downloadTool(url, undefined, `Bearer ${token}`);
        const qpmToolExtract = yield tc.extractZip(qpmTool);
        cachedPath = yield tc.cacheDir(qpmToolExtract, 'qpm', qpmVersion);
        // Add "$GITHUB_WORKSPACE/QPM/" to path
        core.addPath(cachedPath);
        core.debug(`Added ${cachedPath} to path`);
        yield core.group('cache files', () => __awaiter(this, void 0, void 0, function* () {
            for (const file of fs.readdirSync(cachedPath)) {
                core.debug(`${file} ${fs.statSync(path.join(cachedPath, file)).isFile()}`);
            }
            return Promise.resolve();
        }));
        const execFile = path.join(cachedPath, 'qpm');
        yield (0, utils_1.githubExecAsync)(`chmod +x ${execFile}`);
        yield (0, utils_1.githubExecAsync)(`ln ${execFile} ${path.join(cachedPath, 'qpm-rust')}`);
        return execFile;
    });
}
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const qpmFilePath = 'qpm.json';
            const parameters = (0, utils_1.getActionParameters)();
            const { restore, token, version } = parameters;
            const octokit = github.getOctokit(token);
            const qpmRustPath = yield downloadQpm(octokit, token);
            const cachePathOutput = (0, strip_ansi_1.default)((yield (0, utils_1.githubExecAsync)(`${qpmRustPath} ${const_1.QPM_COMMAND_CACHE_PATH}`)).stdout);
            let paths = [];
            let cacheKey;
            const key = 'qpm-cache-';
            if (parameters.cache) {
                // Config path is: (fancycolor)E:\SSDUse\AppData\QPM_Temp
                const cachePath = cachePathOutput
                    .split('Config path is: ')[1]
                    // .substring(2) // substring to ignore fancy color
                    .trim();
                paths = [cachePath];
                const restoreKeys = ['qpm-cache-', 'qpm-cache-'];
                cacheKey = yield cache.restoreCache(paths, key, restoreKeys, undefined, true);
            }
            if (version) {
                core.info(`Using version ${version}`);
                const qpm = yield (0, qpmf_1.readQPM)(qpmFilePath);
                qpm.info.version = version;
                (0, qpmf_1.writeQPM)(qpmFilePath, qpm);
            }
            if (restore) {
                yield (0, utils_1.githubExecAsync)(`${qpmRustPath} ${const_1.QPM_COMMAND_RESTORE}`);
            }
            if (parameters.cache) {
                yield cache.saveCache(paths, cacheKey !== null && cacheKey !== void 0 ? cacheKey : key);
            }
            if (parameters.eagerPublish) {
                (0, publish_1.publishRun)(parameters);
            }
        }
        catch (error) {
            if (error instanceof Error)
                core.setFailed(error.message);
            core.isDebug;
        }
    });
}
run();
