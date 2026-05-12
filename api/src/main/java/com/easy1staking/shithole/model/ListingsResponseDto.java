package com.easy1staking.shithole.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Paginated listings response. Shape matches FE fixture
 * {@code collections/hosky-listings.json}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ListingsResponseDto {

    private Integer total;
    private Integer page;
    private Integer size;
    private List<ListingDto> data;
}
