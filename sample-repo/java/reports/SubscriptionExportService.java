package reports;

import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

/**
 * Planted unbounded-query: fetches every subscription row into memory in
 * one call instead of paginating with a Pageable. TerraTrace should flag
 * the `findAll()` call below.
 */
public class SubscriptionExportService {
    private final SubscriptionRepository subscriptionRepository;

    public SubscriptionExportService(SubscriptionRepository subscriptionRepository) {
        this.subscriptionRepository = subscriptionRepository;
    }

    public Page<Subscription> exportAllSubscriptions(Pageable pageable) {
        return subscriptionRepository.findAll(pageable);
    }
}
