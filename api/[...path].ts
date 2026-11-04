import { handleApi } from "../server/api.js";

export default function handler(req: Request) {
  return handleApi(req);
}
