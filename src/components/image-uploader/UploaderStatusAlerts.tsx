import { NAMESPACE_REQUIRED_UPLOAD_ERROR } from '@/components/image-uploader/constants';

interface UploaderStatusAlertsProps {
  uploadGuardActive: boolean;
  uploadNamespace: string | null;
}

export default function UploaderStatusAlerts({ uploadGuardActive, uploadNamespace }: UploaderStatusAlertsProps) {
  return (
    <>
      {uploadGuardActive && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Upload guard is active. Navigation/reload is blocked while upload tasks are running.
        </div>
      )}
      {!uploadNamespace && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {NAMESPACE_REQUIRED_UPLOAD_ERROR}
        </div>
      )}
      {uploadNamespace && (
        <div className="mb-4 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          You are uploading to the <span className="font-mono font-semibold">{uploadNamespace}</span> namespace. Are you sure this is what you want?
        </div>
      )}
    </>
  );
}
