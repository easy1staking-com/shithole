package com.easy1staking.shithole.controller;

import com.bloxbean.cardano.client.api.exception.ApiRuntimeException;
import com.easy1staking.shithole.model.ConfigRegistrationRequestDto;
import com.easy1staking.shithole.model.ConfigRegistrationResponseDto;
import com.easy1staking.shithole.service.ConfigRegistrationService;
import com.easy1staking.shithole.service.exception.ConfigRegistrationException;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * {@code POST /api/configs} — trustless registration of a curated collection.
 * See {@link ConfigRegistrationService}.
 */
@RestController
@RequestMapping("${shithole.api-prefix:/api}")
@RequiredArgsConstructor
@Slf4j
public class ConfigController {

    /**
     * Generic upstream-unavailable message. We deliberately do not echo
     * Blockfrost-side error text to the client (the response body can contain
     * project-id, internal URLs, or rate-limit-bucket details). Full exception
     * stays in our own logs.
     */
    private static final String BACKEND_UNAVAILABLE_MSG = "Backend temporarily unavailable";

    private final ConfigRegistrationService configRegistrationService;

    @PostMapping(value = "/configs",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<ConfigRegistrationResponseDto> register(
            @RequestBody @Valid ConfigRegistrationRequestDto request) {
        ConfigRegistrationResponseDto response = configRegistrationService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    // ---- error mapping ----------------------------------------------------

    @ExceptionHandler(ConfigRegistrationException.class)
    public ResponseEntity<Map<String, Object>> onRegistrationException(ConfigRegistrationException e) {
        log.warn("config registration rejected: status={} reason={} msg={}",
                e.getStatus(), e.getReason(), e.getMessage());
        return ResponseEntity.status(e.getStatus()).body(errorBody(
                e.getReason().name().toLowerCase(java.util.Locale.ROOT),
                e.getMessage()));
    }

    /**
     * Concurrent submitters both pass the preflight duplicate check then race
     * on the {@code configs.config_nft_policy} / {@code curated_collections.slug}
     * unique indexes. The loser surfaces here.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> onDataIntegrityViolation(DataIntegrityViolationException e) {
        log.warn("duplicate registration race lost: {}", e.getMostSpecificCause() == null
                ? e.getMessage() : e.getMostSpecificCause().getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT).body(errorBody(
                "duplicate_registration",
                "concurrent registration already persisted this config; the existing row wins"));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> onIllegalArgument(IllegalArgumentException e) {
        log.debug("bad request: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorBody("invalid_request", e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> onValidation(MethodArgumentNotValidException e) {
        String details = e.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage())
                .collect(Collectors.joining("; "));
        log.debug("validation failed: {}", details);
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorBody("invalid_request", details));
    }

    /**
     * Catches anything Blockfrost surfaces as a runtime exception (network IO,
     * deserialization failures, etc.). Service-level {@code ConfigRegistrationException}
     * is preferred — see {@code blockfrostUnavailable(...)}. This handler is
     * the belt-and-braces fallback.
     */
    @ExceptionHandler(ApiRuntimeException.class)
    public ResponseEntity<Map<String, Object>> onBackendUnavailable(ApiRuntimeException e) {
        log.error("Blockfrost backend unavailable: {}", e.getMessage(), e);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(errorBody("blockfrost_unavailable", BACKEND_UNAVAILABLE_MSG));
    }

    private Map<String, Object> errorBody(String reason, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("reason", reason);
        body.put("message", message);
        return body;
    }
}
