import { Company } from "./companies";
export interface CustomCompany extends Company {
    addedAt: string;
    addedBy?: string;
}
export declare function loadCustomCompanies(): CustomCompany[];
export declare function saveCustomCompany(company: Omit<CustomCompany, "addedAt">): CustomCompany;
export declare function removeCustomCompany(slug: string): boolean;
export declare function isCustomCompany(slug: string): boolean;
//# sourceMappingURL=customCompanies.d.ts.map