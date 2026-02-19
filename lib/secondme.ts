import axios from "axios";

const BASE_URL = "https://app.mindos.com/gate/lab";

const secondmeApi = axios.create({
  baseURL: BASE_URL,
});

const authHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
});

export type ChatStreamPayload = {
  message: string;
  sessionId?: string;
  appId?: string;
  systemPrompt?: string;
  receiverUserId?: number;
  enableWebSearch?: boolean;
};

export type AddNotePayload = {
  content?: string;
  title?: string;
  urls?: string[];
  memoryType?: "TEXT" | "LINK";
};

export async function getUserInfo(accessToken: string) {
  const response = await secondmeApi.get("/api/secondme/user/info", {
    headers: authHeaders(accessToken),
  });
  return response.data;
}

export async function chatStream(
  accessToken: string,
  payload: ChatStreamPayload,
  options?: { appIdHeader?: string }
) {
  const response = await secondmeApi.post(
    "/api/secondme/chat/stream",
    payload,
    {
      headers: {
        ...authHeaders(accessToken),
        "Content-Type": "application/json",
        ...(options?.appIdHeader ? { "X-App-Id": options.appIdHeader } : {}),
      },
      responseType: "stream",
    }
  );
  return response;
}

export async function addNote(accessToken: string, payload: AddNotePayload) {
  const response = await secondmeApi.post("/api/secondme/note/add", payload, {
    headers: {
      ...authHeaders(accessToken),
      "Content-Type": "application/json",
    },
  });
  return response.data;
}
