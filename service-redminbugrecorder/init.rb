# 本地 Redmine 初始化(rails runner 执行):
#   docker compose cp init.rb redmine:/tmp/init.rb
#   docker compose exec -T redmine bundle exec rails runner /tmp/init.rb
# 幂等:开启 REST API、站点语言、admin 密码/语言,并生成(或复用)API Key。
Setting.rest_api_enabled = '1'
Setting.default_language = 'zh'

user = User.find_by!(login: 'admin')
user.password = ENV['ADMIN_PASSWORD'] || 'Redmine@2026'
user.must_change_passwd = false
user.language = 'zh'
user.save!

token = Token.find_by(user_id: user.id, action: 'api')
unless token
  token = Token.new(user: user, action: 'api')
  token.value = SecureRandom.hex(20)
  token.save!
end

puts "AK=#{token.value}"
puts "REST=#{Setting.rest_api_enabled}"
puts "ADMIN=#{user.login}"
