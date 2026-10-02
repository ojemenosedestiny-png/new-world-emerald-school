declare module "virtual:school-content-catalog" {
  export interface SchoolContentField {
    key: string;
    group: string;
    label: string;
    kind: "text" | "image" | "media" | "file" | "link" | "toggle";
    defaultValue: string;
  }
  export const schoolContentFields: SchoolContentField[];
}