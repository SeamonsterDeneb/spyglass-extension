<?php
/**
 * Plugin Name:       Captain Accessible's Cabin
 * Plugin URI:        https://seamonsterstudios.com/
 * Description:       SeaMonster Studios tools: Screen Reader Ropes Course Leaderboard and Spyglass Contrast Submission collector.
 * Version:           2.2.0
 * Author:            Captain Accessible
 * Author URI:        https://seamonsterstudios.com/
 * License:           GPL v2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       captain-accessible-cabin
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ============================================================
// SECTION 1: SCREEN READER ROPES COURSE LEADERBOARD
// (unchanged from your existing plugin)
// ============================================================

add_action( 'gform_after_submission_48', 'gf_create_score_post', 10, 2 );

function gf_create_score_post( $entry, $form ) {
    $name_field_id            = 4;
    $time_field_id            = 9;
    $tasks_completed_field_id = 10;
    $screen_reader_field_id   = 11;

    $user_name          = sanitize_text_field( rgar( $entry, $name_field_id ) );
    $time_spent         = rgar( $entry, $time_field_id );
    $tasks_completed    = rgar( $entry, $tasks_completed_field_id );
    $screen_reader_used = rgar( $entry, $screen_reader_field_id );

    $unified_score = 0;
    if ( is_numeric( $time_spent ) && $time_spent > 0 && is_numeric( $tasks_completed ) ) {
        $unified_score = round( ( $tasks_completed / $time_spent ) * 1000 );
    }

    wp_insert_post( array(
        'post_type'   => 'score',
        'post_title'  => $user_name,
        'post_status' => 'publish',
        'meta_input'  => array(
            'time_spent'         => $time_spent,
            'tasks_completed'    => $tasks_completed,
            'unified_score'      => $unified_score,
            'screen_reader_used' => $screen_reader_used,
        ),
    ) );
}

function display_ropes_course_leaderboard() {
    $args = array(
        'post_type'      => 'score',
        'posts_per_page' => 10,
        'meta_key'       => 'unified_score',
        'orderby'        => 'meta_value_num',
        'order'          => 'DESC',
    );

    $score_query = new WP_Query( $args );
    ob_start();

    if ( $score_query->have_posts() ) {
        echo '<div class="leaderboard-container">';
        echo '<table class="leaderboard-table">';
        echo '<caption>Screen Reader Ropes Course Leaderboard</caption>';
        echo '<button id="toggle-animation-btn" class="leaderboard-button" aria-pressed="false">Disable Animation</button>';
        echo '<thead><tr><th>Rank</th><th>Name</th><th>Screen Reader</th><th>Time (min)</th><th>Tasks</th><th>Score</th></tr></thead>';
        echo '<tbody>';

        $rank = 1;
        while ( $score_query->have_posts() ) {
            $score_query->the_post();
            $screen_reader = get_post_meta( get_the_ID(), 'screen_reader_used', true );
            $time          = get_post_meta( get_the_ID(), 'time_spent', true );
            $tasks         = get_post_meta( get_the_ID(), 'tasks_completed', true );
            $score         = get_post_meta( get_the_ID(), 'unified_score', true );

            echo '<tr>';
            echo '<th>' . $rank++ . '</th>';
            echo '<td>' . esc_html( get_the_title() ) . '</td>';
            echo '<td>' . esc_html( $screen_reader ) . '</td>';
            echo '<td>' . esc_html( $time ) . '</td>';
            echo '<td>' . esc_html( $tasks ) . '</td>';
            echo '<td>' . esc_html( $score ) . '</td>';
            echo '</tr>';
        }

        echo '</tbody></table></div>';
    } else {
        echo '<div class="leaderboard-container"><p>No scores submitted yet. Be the first!</p></div>';
    }

    wp_reset_postdata();
    return ob_get_clean();
}

add_shortcode( 'screen_reader_leaderboard', 'display_ropes_course_leaderboard' );

function rc_leaderboard_register_score_cpt() {
    $labels = array(
        'name'               => _x( 'Scores', 'post type general name', 'captain-accessible-cabin' ),
        'singular_name'      => _x( 'Score', 'post type singular name', 'captain-accessible-cabin' ),
        'menu_name'          => _x( 'Scores', 'admin menu', 'captain-accessible-cabin' ),
        'add_new'            => _x( 'Add New', 'score', 'captain-accessible-cabin' ),
        'add_new_item'       => __( 'Add New Score', 'captain-accessible-cabin' ),
        'edit_item'          => __( 'Edit Score', 'captain-accessible-cabin' ),
        'view_item'          => __( 'View Score', 'captain-accessible-cabin' ),
        'all_items'          => __( 'All Scores', 'captain-accessible-cabin' ),
        'search_items'       => __( 'Search Scores', 'captain-accessible-cabin' ),
        'not_found'          => __( 'No scores found.', 'captain-accessible-cabin' ),
        'not_found_in_trash' => __( 'No scores found in Trash.', 'captain-accessible-cabin' ),
    );

    register_post_type( 'score', array(
        'labels'          => $labels,
        'public'          => false,
        'show_ui'         => true,
        'show_in_menu'    => true,
        'menu_position'   => 20,
        'menu_icon'       => 'dashicons-awards',
        'has_archive'     => false,
        'supports'        => array( 'title' ),
        'capability_type' => 'post',
        'rewrite'         => false,
    ) );
}
add_action( 'init', 'rc_leaderboard_register_score_cpt' );


// ============================================================
// SECTION 2: SPYGLASS CONTRAST SUBMISSIONS
// ============================================================

// --- 2a. Register the CPT ---

function sg_register_submission_cpt() {
    register_post_type( 'spyglass_sub', array(
        'labels' => array(
            'name'               => 'Spyglass Submissions',
            'singular_name'      => 'Spyglass Submission',
            'menu_name'          => 'Spyglass Submissions',
            'all_items'          => 'All Submissions',
            'add_new_item'       => 'Add New Submission',
            'edit_item'          => 'Edit Submission',
            'not_found'          => 'No submissions found.',
            'not_found_in_trash' => 'No submissions in Trash.',
        ),
        'public'          => false,
        'show_ui'         => true,
        'show_in_menu'    => true,
        'menu_position'   => 21,
        'menu_icon'       => 'dashicons-art',
        'has_archive'     => false,
        'supports'        => array( 'title' ),
        'capability_type' => 'post',
        'rewrite'         => false,
    ) );
}
add_action( 'init', 'sg_register_submission_cpt' );


// --- 2b. REST API endpoint ---

function sg_register_rest_route() {
    register_rest_route( 'spyglass/v1', '/submit', array(
        'methods'             => 'POST',
        'callback'            => 'sg_handle_submission',
        'permission_callback' => 'sg_check_api_key',
    ) );
}
add_action( 'rest_api_init', 'sg_register_rest_route' );

// --- 2e. Allow CORS for Spyglass extension submissions ---
function sg_add_cors_headers() {
    header( 'Access-Control-Allow-Origin: *' );
    header( 'Access-Control-Allow-Methods: POST, OPTIONS' );
    header( 'Access-Control-Allow-Headers: Content-Type, X-Spyglass-Key' );
}
add_action( 'rest_api_init', function() {
    remove_filter( 'rest_pre_serve_request', 'rest_send_cors_headers' );
    add_filter( 'rest_pre_serve_request', function( $value ) {
        sg_add_cors_headers();
        return $value;
    });
}, 15 );

// Handle OPTIONS preflight request
add_action( 'init', function() {
    if ( $_SERVER['REQUEST_METHOD'] === 'OPTIONS' ) {
        sg_add_cors_headers();
        exit;
    }
});

function sg_check_api_key( $request ) {
    $provided_key = $request->get_header( 'X-Spyglass-Key' );
    $expected_key = defined( 'SPYGLASS_API_KEY' ) ? SPYGLASS_API_KEY : '';
    return hash_equals( $expected_key, (string) $provided_key );
}

function sg_handle_submission( $request ) {
    $data = $request->get_json_params();
    if ( empty( $data ) ) {
        return new WP_Error( 'no_data', 'No data received.', array( 'status' => 400 ) );
    }

    // Sanitize everything
    $url             = esc_url_raw( $data['url'] ?? '' );
    $page_title      = sanitize_text_field( $data['page_title'] ?? '' );
    $fg_hex          = sanitize_text_field( $data['fg_hex'] ?? '' );
    $bg_hex          = sanitize_text_field( $data['bg_hex'] ?? '' );
    $detected_size   = sanitize_text_field( $data['detected_size'] ?? '' );
    $detected_weight = sanitize_text_field( $data['detected_weight'] ?? '' );
    $wcag_ratio      = sanitize_text_field( $data['wcag_ratio'] ?? '' );
    $wcag_pass       = (bool) ( $data['wcag_pass'] ?? false );
    $wcag_color_fix  = sanitize_text_field( $data['wcag_color_fix'] ?? '' );
    $wcag_sw_normal  = sanitize_text_field( $data['wcag_size_weight_normal'] ?? '' );
    $wcag_sw_large   = sanitize_text_field( $data['wcag_size_weight_large'] ?? '' );
    $apca_lc         = sanitize_text_field( $data['apca_lc'] ?? '' );
    $apca_size_fix   = sanitize_text_field( $data['apca_size_fix'] ?? '' );
    $apca_weight_fix = sanitize_text_field( $data['apca_weight_fix'] ?? '' );
    $apca_color_fix  = sanitize_text_field( $data['apca_color_fix'] ?? '' );
    $apca_balanced   = sanitize_text_field( $data['apca_balanced'] ?? '' );
    $submitter_name  = sanitize_text_field( $data['submitter_name'] ?? '' );
    $org_tested      = sanitize_text_field( $data['org_tested'] ?? '' );
    $submitter_email = sanitize_email( $data['submitter_email'] ?? '' );
    $use_gravatar    = (bool) ( $data['use_gravatar'] ?? false );

    // Use org or domain as post title
    $post_title = $org_tested ?: ( $url ? wp_parse_url( $url, PHP_URL_HOST ) : 'Unknown' );

    $post_id = wp_insert_post( array(
        'post_type'   => 'spyglass_sub',
        'post_title'  => $post_title,
        'post_status' => 'publish',
        'meta_input'  => array(
            'sg_url'             => $url,
            'sg_page_title'      => $page_title,
            'sg_fg_hex'          => $fg_hex,
            'sg_bg_hex'          => $bg_hex,
            'sg_detected_size'   => $detected_size,
            'sg_detected_weight' => $detected_weight,
            'sg_wcag_ratio'      => $wcag_ratio,
            'sg_wcag_pass'       => $wcag_pass ? '1' : '0',
            'sg_wcag_color_fix'  => $wcag_color_fix,
            'sg_wcag_sw_normal'  => $wcag_sw_normal,
            'sg_wcag_sw_large'   => $wcag_sw_large,
            'sg_apca_lc'         => $apca_lc,
            'sg_apca_size_fix'   => $apca_size_fix,
            'sg_apca_weight_fix' => $apca_weight_fix,
            'sg_apca_color_fix'  => $apca_color_fix,
            'sg_apca_balanced'   => $apca_balanced,
            'sg_submitter_name'  => $submitter_name,
            'sg_org_tested'      => $org_tested,
            'sg_submitter_email' => $submitter_email,
            'sg_use_gravatar'    => $use_gravatar ? '1' : '0',
            'sg_timestamp'       => ( $data['timestamp'] ?? current_time( 'c' ) ),
        ),
    ) );

    if ( is_wp_error( $post_id ) ) {
        return new WP_Error( 'insert_failed', 'Could not save submission.', array( 'status' => 500 ) );
    }

    return rest_ensure_response( array(
        'success' => true,
        'id'      => $post_id,
        'message' => 'Submission received. Thank you!',
    ) );
}


// --- 2c. Enqueue styles for the display page ---

function sg_enqueue_styles() {
    if ( is_page( 'spyglass' ) ) { // change 'spyglass' to your page slug
        wp_enqueue_style(
            'sg-submissions',
            plugin_dir_url( __FILE__ ) . 'spyglass-submissions.css',
            array(),
            '2.0.0'
        );
        wp_enqueue_script(
            'sg-submissions',
            plugin_dir_url( __FILE__ ) . 'spyglass-submissions.js',
            array(),
            '2.0.0',
            true
        );
    }
}
add_action( 'wp_enqueue_scripts', 'sg_enqueue_styles' );


// --- 2d. Shortcode to display submissions ---

function sg_display_submissions( $atts ) {
    $atts = shortcode_atts( array(
        'per_page' => 20,
    ), $atts );

    $args = array(
        'post_type'      => 'spyglass_sub',
        'posts_per_page' => intval( $atts['per_page'] ),
        'orderby'        => 'date',
        'order'          => 'DESC',
    );

    $query = new WP_Query( $args );
    ob_start();

    // Aggregate stats
    $total       = $query->found_posts;
    $fail_count  = 0;
    $lc_values   = array();
    $all_posts   = array();

    if ( $query->have_posts() ) {
        while ( $query->have_posts() ) {
            $query->the_post();
            $id   = get_the_ID();
            $meta = array(
                'id'             => $id,
                'url'            => get_post_meta( $id, 'sg_url', true ),
                'page_title'     => get_post_meta( $id, 'sg_page_title', true ),
                'fg_hex'         => get_post_meta( $id, 'sg_fg_hex', true ),
                'bg_hex'         => get_post_meta( $id, 'sg_bg_hex', true ),
                'detected_size'  => get_post_meta( $id, 'sg_detected_size', true ),
                'detected_weight'=> get_post_meta( $id, 'sg_detected_weight', true ),
                'wcag_ratio'     => get_post_meta( $id, 'sg_wcag_ratio', true ),
                'wcag_pass'      => get_post_meta( $id, 'sg_wcag_pass', true ),
                'wcag_color_fix' => get_post_meta( $id, 'sg_wcag_color_fix', true ),
                'wcag_sw_normal' => get_post_meta( $id, 'sg_wcag_sw_normal', true ),
                'wcag_sw_large'  => get_post_meta( $id, 'sg_wcag_sw_large', true ),
                'apca_lc'        => get_post_meta( $id, 'sg_apca_lc', true ),
                'apca_size_fix'  => get_post_meta( $id, 'sg_apca_size_fix', true ),
                'apca_weight_fix'=> get_post_meta( $id, 'sg_apca_weight_fix', true ),
                'apca_color_fix' => get_post_meta( $id, 'sg_apca_color_fix', true ),
                'apca_balanced'  => get_post_meta( $id, 'sg_apca_balanced', true ),
                'submitter_name' => get_post_meta( $id, 'sg_submitter_name', true ),
                'org_tested'     => get_post_meta( $id, 'sg_org_tested', true ),
                'use_gravatar'   => get_post_meta( $id, 'sg_use_gravatar', true ),
                'submitter_email'=> get_post_meta( $id, 'sg_submitter_email', true ),
                'timestamp'      => get_post_meta( $id, 'sg_timestamp', true ),
            );
            if ( ! $meta['wcag_pass'] ) $fail_count++;
            if ( is_numeric( $meta['apca_lc'] ) ) $lc_values[] = floatval( $meta['apca_lc'] );
            $all_posts[] = $meta;
        }
        wp_reset_postdata();
    }

    $avg_lc      = count( $lc_values ) ? round( array_sum( $lc_values ) / count( $lc_values ), 1 ) : 'N/A';
    $fail_pct    = $total ? round( ( $fail_count / $total ) * 100 ) : 0;

    ?>
    <div class="sg-submissions-wrap" id="sg-submissions-wrap">

      <!-- Aggregate stats bar -->
      <div class="sg-stats-bar">
        <div class="sg-stat">
          <span class="sg-stat__value"><?php echo esc_html( $total ); ?></span>
          <span class="sg-stat__label">Submissions</span>
        </div>
        <div class="sg-stat">
          <span class="sg-stat__value"><?php echo esc_html( $fail_pct ); ?>%</span>
          <span class="sg-stat__label">Fail WCAG AA</span>
        </div>
        <div class="sg-stat">
          <span class="sg-stat__value"><?php echo esc_html( $avg_lc ); ?></span>
          <span class="sg-stat__label">Avg APCA Lc</span>
        </div>
      </div>

      <!-- Sort controls -->
      <div class="sg-controls">
        <div class="sg-sort-controls">
          <label for="sg-sort-select" class="sg-sort-label">Sort by:</label>
          <select id="sg-sort-select" class="sg-sort-select">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="submitter">Submitter A–Z</option>
            <option value="org">Organization A–Z</option>
            <option value="lc_desc">APCA Lc (high–low)</option>
            <option value="lc_asc">APCA Lc (low–high)</option>
            <option value="wcag_fail">WCAG fails first</option>
          </select>
        </div>
        <div class="sg-view-toggle" role="group" aria-label="View mode">
          <button class="sg-view-btn sg-view-btn--active" data-view="cards" aria-pressed="true">Cards</button>
          <button class="sg-view-btn" data-view="table" aria-pressed="false">Table</button>
        </div>
      </div>

      <!-- Card view -->
      <div class="sg-cards" id="sg-cards-view">
        <?php foreach ( $all_posts as $s ) : ?>
          <?php
            $wcag_pass_bool = $s['wcag_pass'] === '1';
            $fg  = esc_attr( $s['fg_hex'] );
            $bg  = esc_attr( $s['bg_hex'] );
            $org = esc_html( $s['org_tested'] ?: wp_parse_url( $s['url'], PHP_URL_HOST ) );
            $submitter = esc_html( $s['submitter_name'] ?: 'Anonymous' );
            $gravatar_url = '';
            if ( $s['use_gravatar'] === '1' && ! empty( $s['submitter_email'] ) ) {
                $hash = md5( strtolower( trim( $s['submitter_email'] ) ) );
                $gravatar_url = "https://www.gravatar.com/avatar/{$hash}?s=40&d=mp";
            }
          ?>
          <div class="sg-card"
               data-submitter="<?php echo esc_attr( $s['submitter_name'] ); ?>"
               data-org="<?php echo esc_attr( $s['org_tested'] ); ?>"
               data-lc="<?php echo esc_attr( $s['apca_lc'] ); ?>"
               data-wcag-pass="<?php echo $wcag_pass_bool ? '1' : '0'; ?>"
               data-timestamp="<?php echo esc_attr( $s['timestamp'] ); ?>">

            <!-- Card header -->
            <div class="sg-card__header">
              <div class="sg-card__header-left">
                <?php if ( $gravatar_url ) : ?>
                  <img src="<?php echo esc_url( $gravatar_url ); ?>" alt="" class="sg-card__gravatar">
                <?php endif; ?>
                <div>
                  <div class="sg-card__org"><?php echo $org; ?></div>
                  <div class="sg-card__meta">
                    <a href="<?php echo esc_url( $s['url'] ); ?>" target="_blank" rel="noopener" class="sg-card__url"><?php echo esc_html( $s['url'] ); ?></a>
                  </div>
                  <div class="sg-card__submitter">Submitted by <?php echo $submitter; ?></div>
                </div>
              </div>
              <div class="sg-card__badges">
                <span class="sg-card__badge sg-card__badge--<?php echo $wcag_pass_bool ? 'pass' : 'fail'; ?>">
                  WCAG <?php echo $wcag_pass_bool ? 'Pass' : 'Fail'; ?>
                </span>
                <span class="sg-card__badge sg-card__badge--lc">
                  Lc <?php echo esc_html( $s['apca_lc'] ); ?>
                </span>
              </div>
            </div>

            <!-- Color pair + detected text preview -->
            <div class="sg-card__colors">
              <div class="sg-card__swatch-pair">
                <div class="sg-card__swatch" style="background:<?php echo $fg; ?>;" title="FG: <?php echo $fg; ?>"></div>
                <div class="sg-card__swatch" style="background:<?php echo $bg; ?>;" title="BG: <?php echo $bg; ?>"></div>
                <code class="sg-card__hex"><?php echo $fg; ?> on <?php echo $bg; ?></code>
                <code class="sg-card__detected"><?php echo esc_html( $s['detected_size'] ); ?>, <?php echo esc_html( $s['detected_weight'] ); ?></code>
              </div>
              <!-- Live detected text preview -->
              <div class="sg-card__preview-wrap" style="background:<?php echo $bg; ?>;">
                <div class="sg-card__preview-text" style="color:<?php echo $fg; ?>;font-size:<?php echo esc_attr( $s['detected_size'] ); ?>;font-weight:<?php echo esc_attr( $s['detected_weight'] ); ?>;">
                  The quick brown fox
                </div>
              </div>
            </div>

            <!-- Fixes grid -->
            <div class="sg-card__fixes">

              <!-- Original -->
              <div class="sg-card__fix">
                <div class="sg-card__fix-label">Original</div>
                <div class="sg-card__fix-preview" style="background:<?php echo $bg; ?>;">
                  <div class="sg-card__fix-text" style="color:<?php echo $fg; ?>;font-size:<?php echo esc_attr( $s['detected_size'] ); ?>;font-weight:<?php echo esc_attr( $s['detected_weight'] ); ?>;">Aa</div>
                </div>
                <code class="sg-card__fix-meta"><?php echo $fg; ?></code>
              </div>

              <!-- WCAG color fix -->
              <?php if ( $s['wcag_color_fix'] && $s['wcag_color_fix'] !== 'N/A' ) : ?>
              <div class="sg-card__fix">
                <div class="sg-card__fix-label">WCAG Color</div>
                <div class="sg-card__fix-preview" style="background:<?php echo $bg; ?>;">
                  <div class="sg-card__fix-text" style="color:<?php echo esc_attr( $s['wcag_color_fix'] ); ?>;font-size:<?php echo esc_attr( $s['detected_size'] ); ?>;font-weight:<?php echo esc_attr( $s['detected_weight'] ); ?>;">Aa</div>
                </div>
                <code class="sg-card__fix-meta"><?php echo esc_html( $s['wcag_color_fix'] ); ?></code>
              </div>
              <?php endif; ?>

              <!-- APCA color fix -->
              <?php if ( $s['apca_color_fix'] && $s['apca_color_fix'] !== 'N/A' && $s['apca_color_fix'] !== '✓' ) : ?>
              <div class="sg-card__fix">
                <div class="sg-card__fix-label">APCA Color</div>
                <div class="sg-card__fix-preview" style="background:<?php echo $bg; ?>;">
                  <div class="sg-card__fix-text" style="color:<?php echo esc_attr( $s['apca_color_fix'] ); ?>;font-size:<?php echo esc_attr( $s['detected_size'] ); ?>;font-weight:<?php echo esc_attr( $s['detected_weight'] ); ?>;">Aa</div>
                </div>
                <code class="sg-card__fix-meta"><?php echo esc_html( $s['apca_color_fix'] ); ?></code>
              </div>
              <?php endif; ?>

              <!-- APCA balanced fix -->
              <?php
                $bal_parts = explode( ' / ', $s['apca_balanced'] );
                $bal_size   = trim( $bal_parts[0] ?? $s['detected_size'] );
                $bal_weight = trim( $bal_parts[1] ?? $s['detected_weight'] );
                $bal_color  = trim( $bal_parts[2] ?? $s['apca_color_fix'] );
                $bal_size   = ( $bal_size === '✓' || $bal_size === 'N/A' ) ? $s['detected_size'] : $bal_size;
                $bal_weight = ( $bal_weight === '✓' || $bal_weight === 'N/A' ) ? $s['detected_weight'] : $bal_weight;
                $bal_color  = ( $bal_color === '✓' || $bal_color === 'N/A' ) ? $s['fg_hex'] : $bal_color;
              ?>
              <div class="sg-card__fix">
                <div class="sg-card__fix-label">APCA Balanced</div>
                <div class="sg-card__fix-preview" style="background:<?php echo $bg; ?>;">
                  <div class="sg-card__fix-text" style="color:<?php echo esc_attr( $bal_color ); ?>;font-size:<?php echo esc_attr( $bal_size ); ?>;font-weight:<?php echo esc_attr( $bal_weight ); ?>;">Aa</div>
                </div>
                <code class="sg-card__fix-meta"><?php echo esc_html( $bal_size . ', ' . $bal_weight . ', ' . $bal_color ); ?></code>
              </div>

            </div><!-- end fixes grid -->

            <!-- Expandable details -->
            <details class="sg-card__details">
              <summary class="sg-card__details-summary">Full data</summary>
              <table class="sg-card__data-table">
                <tr><th>WCAG Ratio</th><td><?php echo esc_html( $s['wcag_ratio'] ); ?></td></tr>
                <tr><th>WCAG Size/Weight (Normal)</th><td><?php echo esc_html( $s['wcag_sw_normal'] ); ?></td></tr>
                <tr><th>WCAG Size/Weight (Large)</th><td><?php echo esc_html( $s['wcag_sw_large'] ); ?></td></tr>
                <tr><th>APCA Lc</th><td><?php echo esc_html( $s['apca_lc'] ); ?></td></tr>
                <tr><th>APCA Size Fix</th><td><?php echo esc_html( $s['apca_size_fix'] ); ?></td></tr>
                <tr><th>APCA Weight Fix</th><td><?php echo esc_html( $s['apca_weight_fix'] ); ?></td></tr>
                <tr><th>APCA Color Fix</th><td><?php echo esc_html( $s['apca_color_fix'] ); ?></td></tr>
                <tr><th>APCA Balanced</th><td><?php echo esc_html( $s['apca_balanced'] ); ?></td></tr>
                <tr><th>Page</th><td><?php echo esc_html( $s['page_title'] ); ?></td></tr>
                <tr><th>Submitted</th><td><?php echo esc_html( $s['timestamp'] ); ?></td></tr>
              </table>
            </details>

          </div><!-- end sg-card -->
        <?php endforeach; ?>
      </div><!-- end sg-cards -->

      <!-- Table view (hidden by default) -->
      <div class="sg-table-wrap" id="sg-table-view" style="display:none;">
        <table class="sg-data-table">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Submitter</th>
              <th>URL</th>
              <th>FG</th>
              <th>BG</th>
              <th>Size</th>
              <th>Weight</th>
              <th>WCAG</th>
              <th>APCA Lc</th>
              <th>APCA Balanced Fix</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            <?php foreach ( $all_posts as $s ) : ?>
              <?php $wcag_pass_bool = $s['wcag_pass'] === '1'; ?>
              <tr data-submitter="<?php echo esc_attr( $s['submitter_name'] ); ?>"
                  data-org="<?php echo esc_attr( $s['org_tested'] ); ?>"
                  data-lc="<?php echo esc_attr( $s['apca_lc'] ); ?>"
                  data-wcag-pass="<?php echo $wcag_pass_bool ? '1' : '0'; ?>"
                  data-timestamp="<?php echo esc_attr( $s['timestamp'] ); ?>">
                <td><?php echo esc_html( $s['org_tested'] ?: wp_parse_url( $s['url'], PHP_URL_HOST ) ); ?></td>
                <td><?php echo esc_html( $s['submitter_name'] ?: 'Anonymous' ); ?></td>
                <td><a href="<?php echo esc_url( $s['url'] ); ?>" target="_blank" rel="noopener"><?php echo esc_html( wp_parse_url( $s['url'], PHP_URL_HOST ) ); ?></a></td>
                <td>
                  <span class="sg-table-swatch" style="background:<?php echo esc_attr( $s['fg_hex'] ); ?>;"></span>
                  <?php echo esc_html( $s['fg_hex'] ); ?>
                </td>
                <td>
                  <span class="sg-table-swatch" style="background:<?php echo esc_attr( $s['bg_hex'] ); ?>;"></span>
                  <?php echo esc_html( $s['bg_hex'] ); ?>
                </td>
                <td><?php echo esc_html( $s['detected_size'] ); ?></td>
                <td><?php echo esc_html( $s['detected_weight'] ); ?></td>
                <td class="<?php echo $wcag_pass_bool ? 'sg-pass' : 'sg-fail'; ?>">
                  <?php echo $wcag_pass_bool ? 'Pass' : 'Fail'; ?> (<?php echo esc_html( $s['wcag_ratio'] ); ?>)
                </td>
                <td><?php echo esc_html( $s['apca_lc'] ); ?></td>
                <td><?php echo esc_html( $s['apca_balanced'] ); ?></td>
                <td><?php echo esc_html( date( 'M j, Y', strtotime( $s['timestamp'] ) ) ); ?></td>
              </tr>
            <?php endforeach; ?>
          </tbody>
        </table>
      </div><!-- end table view -->

    </div><!-- end sg-submissions-wrap -->
    <?php

    return ob_get_clean();
}
add_shortcode( 'spyglass_submissions', 'sg_display_submissions' );