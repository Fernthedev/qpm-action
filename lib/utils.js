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
exports.getReleaseDownloadLink = getReleaseDownloadLink;
exports.execAsync = execAsync;
exports.githubExecAsync = githubExecAsync;
exports.getActionParameters = getActionParameters;
const child_process_1 = require("child_process");
const exec_1 = require("@actions/exec");
const core = __importStar(require("@actions/core"));
const strip_ansi_1 = __importDefault(require("strip-ansi"));
function getReleaseDownloadLink(user, repo, version) {
    return `https://github.com/${user}/${repo}/releases/download/${version}`;
}
function execAsync(command) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            (0, child_process_1.exec)(command, (err, stout, sterr) => {
                if (err) {
                    reject(sterr);
                }
                else {
                    resolve(stout);
                }
            });
        });
    });
}
function githubExecAsync(command) {
    return __awaiter(this, void 0, void 0, function* () {
        const output = yield (0, exec_1.getExecOutput)(command);
        output.stdout = (0, strip_ansi_1.default)(output.stdout);
        output.stderr = (0, strip_ansi_1.default)(output.stderr);
        return output;
    });
}
function stringOrUndefined(str) {
    return str.trim() === '' ? undefined : str;
}
function getActionParameters() {
    const publish = core.getBooleanInput('publish');
    const eagerPublish = core.getBooleanInput('eager_publish');
    const version = stringOrUndefined(core.getInput('version'));
    const tag = stringOrUndefined(core.getInput('tag'));
    const publishToken = stringOrUndefined(core.getInput('publish_token'));
    const qpmReleaseBin = core.getBooleanInput('qpm_release_bin');
    const qpmDebugBin = core.getBooleanInput('qpm_debug_bin');
    const qpmQmod = stringOrUndefined(core.getInput('qpm_qmod'));
    const cache = core.getBooleanInput('cache');
    const cacheLockfile = core.getBooleanInput('cache_lockfile');
    const restore = core.getBooleanInput('restore');
    // This should be a token with access to your repository scoped in as a secret.
    // The YML workflow will need to set myToken with the GitHub Secret Token
    // myToken: ${{ secrets.GITHUB_TOKEN }}
    // https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
    const myToken = core.getInput('workflow_token');
    return {
        qpmDebugBin,
        qpmReleaseBin,
        qpmQmod,
        token: myToken,
        publish,
        version,
        tag,
        cache,
        cacheLockfile,
        restore,
        publishToken,
        eagerPublish
    };
}
