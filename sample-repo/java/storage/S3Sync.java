package storage;

import java.util.List;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;

/**
 * Planted chatty-s3-loop: issues a separate S3 getObject call per key
 * instead of paginating/batching. TerraTrace should flag the `for` loop
 * below.
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
            var request = GetObjectRequest.builder().bucket(bucket).key(key).build();
            s3Client.getObject(request);
        }
    }
}
