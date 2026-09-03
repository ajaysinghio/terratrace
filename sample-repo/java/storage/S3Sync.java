package storage;

import java.nio.file.Paths;
import java.util.List;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.transfer.s3.S3TransferManager;
import software.amazon.awssdk.transfer.s3.model.DownloadFileRequest;
import software.amazon.awssdk.transfer.s3.model.FileDownload;
import java.util.ArrayList;

/**
 * Uses S3TransferManager to issue all downloads concurrently in bulk
 * instead of one blocking getObject call per key.
 */
public class S3Sync {
    private final S3Client s3Client;
    private final String bucket;

    public S3Sync(S3Client s3Client, String bucket) {
        this.s3Client = s3Client;
        this.bucket = bucket;
    }

    public void syncPendingUploads(List<String> keys) {
        for (String key : keys) {
        try (S3TransferManager transferManager = S3TransferManager.builder()
                .s3Client(software.amazon.awssdk.transfer.s3.internal.DefaultS3CrtAsyncClient
                        .builder().build())
                .build()) {
            List<FileDownload> downloads = new ArrayList<>(keys.size());
            for (String key : keys) {
                DownloadFileRequest downloadRequest = DownloadFileRequest.builder()
                        .getObjectRequest(r -> r.bucket(bucket).key(key))
                        .destination(Paths.get(key.replaceAll(".*/", "")))
                        .build();
                downloads.add(transferManager.downloadFile(downloadRequest));
            }
            for (FileDownload download : downloads) {
                download.completionFuture().join();
            }
    }
}
