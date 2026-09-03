import boto3

from .models import PendingUpload

s3 = boto3.client("s3")


def sync_pending_uploads(bucket: str) -> list[str]:
    """Fetch each pending upload's object metadata one at a time.

    Planted chatty-s3-loop: this issues a separate S3 API call per row
    instead of paginating/batching. TerraTrace should flag the `for` loop
    below.
    """
    pending = PendingUpload.objects.filter(synced=False)
    synced_keys = []

    for upload in pending:
        response = s3.get_object(Bucket=bucket, Key=upload.key)
        if response["ContentLength"] > 0:
            synced_keys.append(upload.key)

    return synced_keys
