"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extract_text_from_bytes = extract_text_from_bytes;
const pdf_parse_1 = __importDefault(require("pdf-parse"));
/**
 * Extract plain text from a PDF buffer.
 */
async function extract_text_from_bytes(buf) {
    const result = await (0, pdf_parse_1.default)(buf);
    return result.text;
}
//# sourceMappingURL=pdfUtil.js.map