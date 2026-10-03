<?php
// Local dev/test router for `php -S` that mimics the production .htaccess:
// clean URLs (/packages -> packages.html), 404.html fallback, and PHP for /api/*.php.
// Usage: php -S 127.0.0.1:4321 -t dist tests/router.php
$root = $_SERVER['DOCUMENT_ROOT'];
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');

if (str_contains($path, '..')) { http_response_code(400); exit; }

// Trailing slash -> no trailing slash (except root), like production.
if ($path !== '/' && str_ends_with($path, '/')) {
    header('Location: ' . rtrim($path, '/'), true, 301);
    exit;
}

$file = $root . $path;
if ($path === '/') $file = $root . '/index.html';

if (is_file($file)) {
    if (str_ends_with($file, '.php')) return false; // let PHP execute it
    $types = ['html' => 'text/html; charset=utf-8', 'css' => 'text/css', 'js' => 'text/javascript', 'json' => 'application/json',
        'svg' => 'image/svg+xml', 'xml' => 'application/xml', 'txt' => 'text/plain', 'webmanifest' => 'application/manifest+json',
        'avif' => 'image/avif', 'webp' => 'image/webp', 'jpg' => 'image/jpeg', 'png' => 'image/png', 'ico' => 'image/x-icon',
        'woff2' => 'font/woff2', 'woff' => 'font/woff'];
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    if (isset($types[$ext])) header('Content-Type: ' . $types[$ext]);
    readfile($file);
    return true;
}
if (is_file($file . '.html')) {
    header('Content-Type: text/html; charset=utf-8');
    readfile($file . '.html');
    return true;
}
http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
if (is_file($root . '/404.html')) readfile($root . '/404.html');
return true;
