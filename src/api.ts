import { QPM_Rust_ARTIFACT_URL } from "./const"
import * as node_os from "os"
import axios from "axios"

/**
 * https://docs.github.com/en/rest/reference/actions#artifacts
 *     {
      "id": 196864463,
      "node_id": "MDg6QXJ0aWZhY3QxOTY4NjQ0NjM=",
      "name": "windows-qpm-rust.exe",
      "size_in_bytes": 3778560,
      "url": "https://api.github.com/repos/RedBrumbler/QuestPackageManager-Rust/actions/artifacts/196864463",
      "archive_download_url": "https://api.github.com/repos/RedBrumbler/QuestPackageManager-Rust/actions/artifacts/196864463/zip",
      "expired": false,
      "created_at": "2022-03-29T19:05:24Z",
      "updated_at": "2022-03-29T19:05:24Z",
      "expires_at": "2022-06-27T19:03:59Z"
    },
 */
export interface Artifact {
    id: number,
    node_id: string,
    name: string,
    size_in_bytes: number,
    url: string,
    archive_download_url: string,
    expired: string,
    created_at: string, // TODO: Find JSON compatible Date type
    updated_at: string,
    expires_at: string
}

export interface ArtifactsResponse {
    total_count: number,
    artifacts: Artifact[]
}

export function GetQPM_RustExecutableName() {
    let os: string = node_os.platform()

    if (os === "win32") os = "windows"
    if (os === "darwin") os = "macos"

    return `${os}-qpm-rust`
}

export async function GetLatestQPMArtifact() {
    const response = await axios.get(QPM_Rust_ARTIFACT_URL)
    const artifactsJson: ArtifactsResponse = await response.data
    const artifactName = GetQPM_RustExecutableName()

    return artifactsJson.artifacts.find(artifact => artifact.name === artifactName)
}