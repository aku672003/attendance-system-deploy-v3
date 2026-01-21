# Prefer native mysqlclient (MySQLdb). Fallback to PyMySQL only if mysqlclient isn't installed.
try:
    import MySQLdb  # provided by mysqlclient
except ImportError:
    try:
        import pymysql
        pymysql.install_as_MySQLdb()
    except ImportError:
        pass

