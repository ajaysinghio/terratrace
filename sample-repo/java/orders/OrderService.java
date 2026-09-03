package orders;

import java.util.List;

/**
 * Planted N+1: fetches one Order per customer inside the loop instead of a
 * single batched query (e.g. Spring Data's findAllById). TerraTrace should
 * flag the `for` loop below.
 */
public class OrderService {
    private final OrderRepository orderRepository;

    public OrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    public long totalOrderValue(List<Long> customerIds) {
        long total = 0;
        for (Long customerId : customerIds) {
            Order order = orderRepository.findById(customerId);
            total += order.getAmount();
        }
        return total;
    }
}
