export interface ResumeSection {
    heading: string;
    content: string;
    lines: string[];
}
export interface WorkEntry {
    company: string;
    title: string;
    startDate: string;
    endDate: string;
    bullets: string[];
}
export interface ResumeData {
    raw: string;
    sections: ResumeSection[];
    experience: WorkEntry[];
    education: string[];
    skills: string[];
}
/**
 * Parse a resume PDF or text file into structured ResumeData.
 */
export declare function parseResume(filePath: string): Promise<ResumeData>;
//# sourceMappingURL=parser.d.ts.map