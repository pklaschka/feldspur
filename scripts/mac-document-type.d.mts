export const PROJECT_UTI: string;
export const PROJECT_EXTENSION: string;
export const PROJECT_ICON_FILE: string;
export function macDocumentTypes(): {
  UTExportedTypeDeclarations: Array<{
    UTTypeIdentifier: string;
    UTTypeDescription: string;
    UTTypeConformsTo: string[];
    UTTypeIconFile: string;
    UTTypeTagSpecification: { "public.filename-extension": string[] };
  }>;
  CFBundleDocumentTypes: Array<{
    CFBundleTypeName: string;
    CFBundleTypeRole: string;
    CFBundleTypeIconFile: string;
    LSItemContentTypes: string[];
    LSHandlerRank: string;
  }>;
};
