# Kế hoạch hỗ trợ upload file lớn qua Cloudflare

## Vấn đề hiện tại
- Cloudflare Free giới hạn **100MB/request**
- User cần upload file **hàng trăm MB đến hàng GB**

## Giải pháp hiện tại (đã có sẵn)

### Chunk Upload
- **Server**: `src/routes/cloudRoutes.js`
  - `MAX_CHUNK_SIZE_BYTES = 90MB`
  - `DEFAULT_CHUNK_SIZE_BYTES = 80MB`
  - `MAX_CHUNK_FILE_BYTES = 3GB`
- **Client**: `p/cloud.html`
  - `CHUNK_SIZE_BYTES = 80MB`
  - Tự động dùng chunk mode khi file > 99MB
  - Retry logic khi upload fail

### Cách hoạt động
```
User upload file 500MB
  ↓
Client: File > 99MB → dùng chunk upload
  ↓
Chia file thành các chunk 80MB:
  - Chunk 1: 80MB
  - Chunk 2: 80MB
  - Chunk 3: 80MB
  - Chunk 4: 80MB
  - Chunk 5: 80MB
  - Chunk 6: 80MB
  - Chunk 7: 20MB (phần còn lại)
  ↓
Mỗi chunk gửi qua API riêng biệt
  ↓
Server ghép các chunk lại thành file hoàn chỉnh
```

## Các tùy chọn bổ sung (nếu cần)

### Tùy chọn 1: Subdomain không qua Cloudflare
**Ưu điểm:**
- Bỏ qua hoàn toàn giới hạn 100MB
- Upload nhanh hơn (không qua Cloudflare)

**Nhược điểm:**
- Giảm bảo mật (không có Cloudflare lọc attack)
- Cần cấu hình thêm DNS

**Triển khai:**
1. Tạo subdomain `upload.yourdomain.com`
2. Trỏ DNS **Direct** (không qua proxy - icon mây xám)
3. Thêm config trong code để dùng subdomain cho file lớn

### Tùy chọn 2: Tăng chunk size lên ~95MB
**Lý do:**
- Cloudflare limit 100MB, để dư 5MB buffer
- Chunk 95MB sẽ gần giới hạn nhưng an toàn

### Tùy chọn 3: Upload qua R2/S3
**Ưu điểm:**
- Không giới hạn upload size
- Tốc độ cao (Cloudflare backbone)

**Nhược điểm:**
- Cần Cloudflare R2 (có free tier)
- Phức tạp hơn để triển khai

## File cần chỉnh sửa (nếu có)

### Server-side
| File | Thay đổi |
|------|----------|
| `src/routes/cloudRoutes.js` | Điều chỉnh chunk size nếu cần |
| `src/config/index.js` | Thêm config cho upload subdomain (tùy chọn) |

### Client-side
| File | Thay đổi |
|------|----------|
| `p/cloud.html` | Điều chỉnh chunk size, thêm subdomain support (tùy chọn) |

## Khuyến nghị

Với tình hình hiện tại:
1. **Chunk upload 80MB đã work** - Test thử xem có vấn đề gì không
2. Nếu cần tối ưu thêm → Tăng chunk lên 90-95MB
3. Nếu cần upload >3GB → Dùng subdomain hoặc R2

## Testing checklist
- [ ] Upload file 100MB
- [ ] Upload file 500MB  
- [ ] Upload file 1GB
- [ ] Kiểm tra progress bar hiển thị đúng
- [ ] Kiểm tra retry khi fail
- [ ] Kiểm tra sau khi complete, file nguyên vẹn
